import { Desire, type DesireDef } from "./Desires.ts";
import { EXPLAINED_COOLDOWN, type PropExplainer } from "./Explainers.ts";

/**
 * A person who acts on desires (docs/DESIRES.md): their desires grow, the most urgent one that has a prop to use is started, and the activity walks them to the prop's goal, turns them to its
 * heading and holds them there while they use it. A stand-in for `TMCharacter_UpdateActionSelection` and the runner states of `MOVEMENT.md` ("Getting from A to B"): the choices that are not
 * read are marked [guess] below. Pure logic over an `Actor`: no engine or browser API.
 */

/** What the agent needs from the body it drives. */
export interface Actor {
  x: number;
  y: number;
  /** Whether a route is being walked. */
  readonly walking: boolean;
  /** Start walking to a point; false when there is no route. */
  walkTo(x: number, y: number): boolean;
  /** Turn toward a heading for `dt` seconds; true once facing it. */
  turnTo(heading: number, dt: number): boolean;
  stop(): void;
}

/** The game ticks its simulation 10 times a second (MAIN_LOOP.md); one desire update per tick. [guess] (the adaptive skipping of `TMBaseDesire_TickShared` is not modelled.) */
export const DESIRE_UPDATE_SECONDS = 0.1;
/** Seconds between attempts to start an action while idle. [guess] (the timer's interval is not read.) */
export const TRY_START_SECONDS = 2;
/** How long a use lasts. [guess] (the interaction scenes are not played, so their length is not known here.) */
export const USE_SECONDS = 8;
/**
 * The urgency a desire must pass to start while the person has nothing running. The game compares with the urgency of the running action (0 when none), but an idle character there always
 * has one: the `roam` and `wander` desires are always running. Those are not ported, so this stands in for them. [guess] 0.5 (crap starts at 0.2 to 0.5 and takes about four game minutes
 * to pass it).
 */
export const IDLE_THRESHOLD = 0.5;
/** Within this of the goal counts as arrived when the route ended short of it (the goal may lie inside a footprint the grid blocks). */
const ARRIVED = 3;

export type ActivityState = "enroute" | "turning" | "waiting" | "using";

export interface Activity {
  desire: Desire;
  prop: PropExplainer;
  state: ActivityState;
  /** Seconds left of the use. */
  left: number;
}

export class DesireAgent {
  readonly desires: Desire[];
  activity: Activity | null = null;
  private sinceTry: number;
  private sinceTick = 0;
  /** What a desire has to beat to start (`IDLE_THRESHOLD` unless the caller sets another). */
  threshold = IDLE_THRESHOLD;

  /** `actions` are the desire names this person has (for example `crap_male`, `buyfood`); a name missing from the table is skipped. */
  constructor(table: Map<string, DesireDef>, actions: string[], random: () => number = Math.random) {
    this.desires = [];
    for (const a of actions) {
      const def = table.get(a);
      if (def) this.desires.push(new Desire(def, random));
    }
    this.sinceTry = random() * TRY_START_SECONDS; // do not start every person in the same tick
  }

  /** Give up the current activity (picked up, sent elsewhere): the prop is free again. */
  cancel(): void {
    const a = this.activity;
    if (!a) return;
    a.prop.users = Math.max(0, a.prop.users - 1);
    if (a.state === "using") a.prop.occupied = false;
    this.activity = null;
  }

  /**
   * Advance by `dt` game seconds. `now` is the game time in seconds (props are "taken" for a moment after they are chosen). Returns true while the person is busy with an activity, so the
   * caller keeps its own idle behaviour (wandering) off.
   */
  update(dt: number, actor: Actor, props: readonly PropExplainer[], now: number): boolean {
    this.sinceTick += dt;
    while (this.sinceTick >= DESIRE_UPDATE_SECONDS) {
      this.sinceTick -= DESIRE_UPDATE_SECONDS;
      for (const d of this.desires) d.tick();
    }
    const a = this.activity;
    if (!a) {
      this.sinceTry += dt;
      if (this.sinceTry >= TRY_START_SECONDS) {
        this.sinceTry = 0;
        this.tryStart(actor, props, now);
      }
      return this.activity !== null;
    }
    switch (a.state) {
      case "enroute":
        if (!actor.walking) {
          const g = a.prop.goal;
          if (Math.hypot(g.x - actor.x, g.y - actor.y) > ARRIVED && !actor.walkTo(g.x, g.y)) { this.cancel(); break; } // fell short and no route: give up
          if (!actor.walking) a.state = "turning";
        }
        break;
      case "turning":
        if (actor.turnTo(a.prop.goal.heading, dt)) this.arrive(a);
        break;
      case "waiting":
        if (!a.prop.occupied) this.arrive(a);
        break;
      case "using":
        a.left -= dt;
        if (a.left <= 0) {
          a.desire.reset();
          a.prop.occupied = false;
          a.prop.users = Math.max(0, a.prop.users - 1);
          this.activity = null;
        }
        break;
    }
    return this.activity !== null;
  }

  /** At the prop and facing it: use it if nobody is, else wait for them. */
  private arrive(a: Activity): void {
    if (a.prop.occupied) { a.state = "waiting"; return; }
    a.prop.occupied = true;
    a.state = "using";
    a.left = USE_SECONDS;
  }

  /**
   * `TMCharacter_TryStartAnyDesireAction`: the desires from the most urgent down; the first above the threshold with a prop that can serve it and a route to it starts; of the props the
   * cheapest wins (`CMetaExplainer_StartCheapest`).
   */
  private tryStart(actor: Actor, props: readonly PropExplainer[], now: number): void {
    const sorted = [...this.desires].sort((p, q) => q.level - p.level);
    for (const desire of sorted) {
      if (desire.level <= this.threshold) break;
      const scored: { prop: PropExplainer; cost: number }[] = [];
      for (const prop of props) {
        const cost = prop.cost(desire.action, actor.x, actor.y, now);
        if (cost !== null) scored.push({ prop, cost });
      }
      scored.sort((p, q) => p.cost - q.cost);
      for (const { prop } of scored) {
        if (!actor.walkTo(prop.goal.x, prop.goal.y)) continue; // no route to it: next cheapest
        prop.users++;
        prop.takenUntil = now + EXPLAINED_COOLDOWN;
        this.activity = { desire, prop, state: "enroute", left: 0 };
        return;
      }
    }
  }
}
