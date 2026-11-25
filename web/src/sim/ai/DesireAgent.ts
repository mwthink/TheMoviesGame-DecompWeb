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

/** The game ticks its simulation 10 times a second (MAIN_LOOP.md); a desire's `TMBaseDesire_TickShared` is called once per tick [inferred], and skips updates by its rank (`Desire.step`). */
export const DESIRE_UPDATE_SECONDS = 0.1;
/** Seconds between re-sorting a person's desires by urgency, which sets their ranks (`TMCharacter_SortResidentDesires`, driven by a timer in `UpdateActionSelection`). [guess] (the timer's interval is not read.) */
export const SORT_SECONDS = 1;
/** Seconds between attempts to start an action while idle. [guess] (the timer's interval is not read.) */
export const TRY_START_SECONDS = 2;
/** How long a use lasts. [guess] (the interaction scenes are not played, so their length is not known here.) */
export const USE_SECONDS = 8;
/**
 * The urgency a desire must pass to start while the person has nothing running. The game compares with the urgency of the running action, 0 when there is none, so with nothing running any
 * desire above 0 would start at once, and a desire reset to 0 would start again a tick later. A character in the game usually has other desires running (staff and stars have `readyposition`,
 * entourage `play`, `gawp`, `follow boss`; the desires `roam` and `wander` are in the table but no code creates them: docs/DESIRES.md), which are not ported, so this stands in for them.
 * [guess] 0.5.
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
  private sinceSort = 0;
  private readonly random: () => number;
  /** What a desire has to beat to start (`IDLE_THRESHOLD` unless the caller sets another). */
  threshold = IDLE_THRESHOLD;

  /** `actions` are the desire names this person has (for example `crap_male`, `buyfood`); a name missing from the table is skipped. */
  constructor(table: Map<string, DesireDef>, actions: string[], random: () => number = Math.random) {
    this.random = random;
    this.desires = [];
    for (const a of actions) {
      const def = table.get(a);
      if (def) this.desires.push(new Desire(def, random));
    }
    this.sinceTry = random() * TRY_START_SECONDS; // do not start every person in the same tick
    this.rankDesires();
  }

  /** Sort the desires by level, most urgent first, and give each its rank (`TMCharacter_SortResidentDesires`). */
  private rankDesires(): void {
    [...this.desires].sort((p, q) => q.level - p.level).forEach((d, i) => { d.rank = i; });
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
    this.sinceSort += dt;
    if (this.sinceSort >= SORT_SECONDS) { this.sinceSort = 0; this.rankDesires(); }
    while (this.sinceTick >= DESIRE_UPDATE_SECONDS) {
      this.sinceTick -= DESIRE_UPDATE_SECONDS;
      for (const d of this.desires) d.step();
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
          this.satisfy(a);
          a.prop.occupied = false;
          a.prop.users = Math.max(0, a.prop.users - 1);
          this.activity = null;
        }
        break;
    }
    return this.activity !== null;
  }

  /**
   * What a finished use does. A prop that lists a `desire_<name>` slider for a desire of this person adjusts it by that amount (a bench takes a little off `propinteract`); a desire the prop says
   * nothing about is satisfied outright (`DesireCrap_ResetUrgency`). [guess] the sliders are applied once, at the end of the use (the game applies them when the scene fires its event).
   */
  private satisfy(a: Activity): void {
    let slid = false;
    for (const d of this.desires) {
      const delta = a.prop.def.desireSliders.get(d.action);
      if (delta !== undefined) { d.adjust(delta); slid = true; }
    }
    if (!slid) a.desire.reset();
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
      // the cheapest first; props that cost the same (many have no weights at all) in a random order, as `CMetaExplainer_StartRandomUsable` would pick
      for (let i = scored.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [scored[i], scored[j]] = [scored[j]!, scored[i]!]; }
      scored.sort((p, q) => p.cost - q.cost);
      for (const { prop } of scored) {
        if (!actor.walkTo(prop.goal.x, prop.goal.y)) continue; // no route to it: next cheapest
        prop.users++;
        prop.takenUntil = now + EXPLAINED_COOLDOWN;
        prop.def.type.chosenAt = now;
        this.activity = { desire, prop, state: "enroute", left: 0 };
        return;
      }
    }
  }
}
