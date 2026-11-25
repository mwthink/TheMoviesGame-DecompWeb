import { Desire, type DesireDef } from "./Desires.ts";
import { EXPLAINED_COOLDOWN, type PropExplainer } from "./Explainers.ts";
import type { SceneGraph } from "../../formats/FlmScene.ts";
import { SceneRunner } from "../scene/SceneRunner.ts";

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
  /** Which way the person faces (for anchoring a scene); optional, 0 when absent. */
  readonly heading?: number;
  /** Play a clip in place of the person's idle (a scene's clip); null returns to the idle. Optional: without it a scene's clips are not shown. */
  playClip?(name: string | null): void;
  /** Put the person somewhere facing a way (a scene moves them); optional. */
  placeAt?(x: number, y: number, heading: number): void;
}

/** What playing a prop's interaction scene needs to know about the person and the loaded animations. */
export interface SceneContext {
  /** The scenes the props name, by lower-case file name. */
  graphs: ReadonlyMap<string, SceneGraph>;
  female: boolean;
  /** A star (the scene's `ai_star` channel). */
  star: boolean;
  /** How long a clip lasts, ms, or undefined when it is not loaded for this person. */
  clipMs(name: string): number | undefined;
  /** How fast a walk clip moves, units per second. */
  walkSpeed(name: string | null): number | undefined;
}

/** The game ticks its simulation 10 times a second (MAIN_LOOP.md); `SimObjectQueue_TickPending` calls every simulation object's tick slot, a desire's `TMBaseDesire_TickShared`, once per tick [read], and that skips updates by the desire's rank (`Desire.step`). */
export const DESIRE_UPDATE_SECONDS = 0.1;
/** Seconds between re-sorting a person's desires by urgency, which sets their ranks: the character's sort timer (`+0x700`) is set to 5 ticks in its constructor (`TMCharacter_UpdateActionSelection`, `Timer_IsElapsed`). [read] (A star's is 2.) */
export const SORT_SECONDS = 0.5;
/** Seconds between attempts to start an action while idle: the start timer (`+0x710`) takes its interval from `+0x720` every tick, which is 1 for everyone but staff in an attention state. [read] */
export const TRY_START_SECONDS = 0.1;
/** How long to leave a prop alone after there was no route to it. Not the game's (its route is found by a worker thread and the cost check does no search): it only keeps the port from searching every tick. */
const UNREACHABLE_SECONDS = 5;
/** How long a use lasts for a prop with no scene to play. [guess] */
export const USE_SECONDS = 8;
/**
 * The urgency a desire must pass to start while the person has nothing running. The game compares with the urgency of the running action, 0 when there is none, so with nothing running any
 * desire above 0 would start at once, and a desire reset to 0 would start again a tick later. A character in the game usually has other desires running (staff and stars have `readyposition`,
 * entourage `play`, `gawp`, `follow boss`; the desires `roam` and `wander` are in the table but no code creates them: docs/DESIRES.md), which are not ported, so this stands in for them.
 * [guess] 0.5.
 */
export const IDLE_THRESHOLD = 0.5;
/** The longest a use may run before the scene is told to stop (`ai_stop`). [guess] */
export const MAX_USE_SECONDS = 180;
/** Seconds between checks of whether to stop a looping scene. */
const STOP_CHECK_SECONDS = 1;
/** Within this of the goal counts as arrived when the route ended short of it (the goal may lie inside a footprint the grid blocks). */
const ARRIVED = 3;

/**
 * The ported desires a person holds, by class. [read] Hired staff and stars are created with crap, buy food, prop interact and more (`CStaff_OnHired`, `0057A2E0`), a wannabe with only `play`
 * (`FUN_0058CB00`), which no prop offers: the port gives a wannabe nothing to walk to. Stars also hold sleep, drunk, overeat, tantrum, talk and others (`CStar_PostSpawnSetup`), not ported.
 */
export function desireActionsFor(cls: string, female: boolean): string[] {
  if (cls === "CWannabe") return ["play"];
  return [female ? "crap_female" : "crap_male", "buyfood", "propinteract"];
}

export type ActivityState = "enroute" | "turning" | "waiting" | "using";

export interface Activity {
  desire: Desire;
  prop: PropExplainer;
  state: ActivityState;
  /** Seconds left of the use (when there is no scene to play). */
  left: number;
  /** The scene being played, and where it is anchored in the world; null when the prop's scene is not available. */
  runner: SceneRunner | null;
  anchor: { x: number; y: number; heading: number };
  /** Seconds in use, and since the last check of whether to stop. */
  usedFor: number;
  sinceCheck: number;
  /** A slider the scene fired changed a desire (so the use does not also reset it). */
  adjusted: boolean;
  /** `ai_stop` has been sent. */
  stopping: boolean;
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

  private readonly scenes: SceneContext | undefined;
  private lastActor: Actor | null = null;
  private readonly unreachable = new Map<PropExplainer, number>();

  /**
   * `actions` are the desire names this person has (for example `crap_male`, `buyfood`); a name missing from the table is skipped. With `scenes` the use of a prop plays the prop's interaction
   * scene; without, or for a prop whose scene is missing, a use lasts `USE_SECONDS` and the prop's sliders are applied at its end.
   */
  constructor(table: Map<string, DesireDef>, actions: string[], random: () => number = Math.random, scenes?: SceneContext) {
    this.random = random;
    this.scenes = scenes;
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
    if (a.state === "using") { a.prop.occupied = false; this.lastActor?.playClip?.(null); }
    this.activity = null;
  }

  /**
   * Advance by `dt` game seconds. `now` is the game time in seconds (props are "taken" for a moment after they are chosen). Returns true while the person is busy with an activity, so the
   * caller keeps its own idle behaviour (wandering) off.
   */
  update(dt: number, actor: Actor, props: readonly PropExplainer[], now: number): boolean {
    this.lastActor = actor;
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
        if (a.runner) this.runScene(a, dt, actor);
        else {
          a.left -= dt;
          if (a.left <= 0) { this.satisfy(a); this.release(a); }
        }
        break;
    }
    return this.activity !== null;
  }

  /** The use is over: the prop is free and the person is theirs again. */
  private release(a: Activity): void {
    a.prop.occupied = false;
    a.prop.users = Math.max(0, a.prop.users - 1);
    this.activity = null;
  }

  /**
   * One step of a use with a scene: step the scene, play its clip and place the person where it puts them, apply the sliders it fires, and tell it to stop when the person has had enough
   * (`ai_stop`). The game stops a running action when a better desire starts (`CActivity_SendAiStopToProp`) or the prop is worn out; the port stops it when its own desire is used up or another
   * desire is above both it and the idle threshold, or after `MAX_USE_SECONDS`. [inferred]
   */
  private runScene(a: Activity, dt: number, actor: Actor): void {
    const runner = a.runner!;
    a.usedFor += dt;
    a.sinceCheck += dt;
    if (!a.stopping && a.sinceCheck >= STOP_CHECK_SECONDS) {
      a.sinceCheck = 0;
      const own = a.desire.level;
      const other = this.desires.reduce((m, d) => (d === a.desire ? m : Math.max(m, d.level)), 0);
      if (a.usedFor >= MAX_USE_SECONDS || own <= 0.001 || other > Math.max(own, this.threshold)) { a.stopping = true; runner.setChannel("ai_stop", 1); }
    }
    runner.step(dt);
    for (const set of runner.takeEvents()) {
      const deltas = a.prop.def.sliderSets.get(set);
      if (!deltas) continue;
      for (const d of this.desires) {
        const delta = deltas.get(d.action);
        if (delta !== undefined) { d.adjust(delta); a.adjusted = true; }
      }
    }
    if (runner.finished) {
      actor.playClip?.(null);
      if (!a.adjusted) a.desire.reset(); // a use that never touched the desire (a toilet, a counter) satisfies it outright
      this.release(a);
      return;
    }
    actor.playClip?.(runner.clip);
    if (actor.placeAt) {
      // the scene is anchored so that its start box is where the person stands facing their way: its own frame, turned by the difference of the headings
      const turn = a.anchor.heading - runner.start.yaw;
      const c = Math.cos(turn), s = Math.sin(turn);
      const lx = runner.place.x - runner.start.x, ly = runner.place.y - runner.start.y;
      actor.placeAt(a.anchor.x + c * lx - s * ly, a.anchor.y + s * lx + c * ly, runner.place.yaw + turn);
    }
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
    const ctx = this.scenes;
    const graph = ctx && a.prop.def.interaction ? ctx.graphs.get(a.prop.def.interaction.toLowerCase()) : undefined;
    if (ctx && graph && graph.actors.length > 0) {
      a.runner = new SceneRunner(graph, {
        female: ctx.female, random: this.random, clipMs: ctx.clipMs, walkSpeed: ctx.walkSpeed,
        sliderSets: new Set(a.prop.def.sliderSets.keys()),
        channels: { ai_male: ctx.female ? 0 : 1, ai_star: ctx.star ? 1 : 0, ai_drunk: 0 },
      });
      a.anchor = { x: this.lastActor?.x ?? 0, y: this.lastActor?.y ?? 0, heading: this.lastActor?.heading ?? 0 };
    }
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
        if ((this.unreachable.get(prop) ?? 0) > now) continue;
        const cost = prop.cost(desire.action, actor.x, actor.y, now);
        if (cost !== null) scored.push({ prop, cost });
      }
      // the cheapest first; props that cost the same (many have no weights at all) in a random order, as `CMetaExplainer_StartRandomUsable` would pick
      for (let i = scored.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [scored[i], scored[j]] = [scored[j]!, scored[i]!]; }
      scored.sort((p, q) => p.cost - q.cost);
      for (const { prop } of scored) {
        if (!actor.walkTo(prop.goal.x, prop.goal.y)) { this.unreachable.set(prop, now + UNREACHABLE_SECONDS); continue; } // no route to it: next cheapest
        prop.users++;
        prop.takenUntil = now + EXPLAINED_COOLDOWN;
        prop.def.type.chosenAt = now;
        this.activity = { desire, prop, state: "enroute", left: 0, runner: null, anchor: { x: 0, y: 0, heading: 0 }, usedFor: 0, sinceCheck: 0, adjusted: false, stopping: false };
        return;
      }
    }
  }
}
