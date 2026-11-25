import type { Point } from "../nav/NavGrid.ts";
import { turnClipId, type Locomotion } from "./Gaits.ts";

/**
 * How a walker's heading follows its way while it walks. [read] The game does not stop to turn: each tick (10 a second) `PathAgent_StepAlongRoute` moves the position toward the next
 * waypoint and the heading 35 % of the way to the direction of travel (`Angle_LerpShortest` with 0.35), so a person who has to turn round keeps moving while they swing round.
 */
const STEER_PER_TICK = 0.35;
const TICK_SECONDS = 0.1;
/** The share of the way to the new heading covered in `dt` seconds, so the steering does not depend on the frame rate. */
function steerShare(dt: number): number { return 1 - Math.pow(1 - STEER_PER_TICK, dt / TICK_SECONDS); }
/** How long a turn on the spot takes unless the caller sets `turnSeconds` from its clip (`turnSeconds` in Gaits.ts: 0.7 s for the six turn clips). */
export const TURN_SECONDS = 0.7;
/**
 * Speed. [read] `PathAgent_UpdateSpeed` (orig 0x004AB440) works in units per tick. With the route empty the speed is 0. Otherwise the speed rises by `acceleration` a tick (0.01 units per tick
 * squared, set in `PathAgent_BaseConstructor`; 1.0 units per second squared at 10 ticks a second) up to the gait's speed, and never falls below half of it (`0.5`, `0xD1694C`): a person
 * starting from rest is at half speed in the first tick. Within the square root of 3 units of the goal (squared distance under `0xD1DCFC` = 3), when the prop's slow-approach flag is set
 * (`+0x2B3`, on by default in `TMProp_Constructor`), the speed is instead brought down to `min + (distance squared / 3) * (max - min)`, never up: half speed at the goal.
 */
const ACCELERATION = 1.0; // units per second squared
const MIN_SPEED_SHARE = 0.5;
const SLOW_RANGE_SQ = 3;

/** Closer than this to a waypoint counts as having reached it. */
const REACHED = 0.15;

/** Wrap an angle to (-pi, pi]. */
export function wrapAngle(a: number): number {
  const t = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return t === -Math.PI ? Math.PI : t;
}

/** An angle moved `t` of the way to another, the short way round (`FUN_00429400`, orig 0x00429400). */
export function lerpAngle(from: number, to: number, t: number): number {
  return wrapAngle(from + wrapAngle(to - from) * t);
}

/**
 * One character walking a route (docs/MOVEMENT.md): a position and a heading in game coordinates (heading 0 faces +x, counter-clockwise), a list of waypoints, and the gait
 * (`Locomotion`: stroll, walk or run) that decides the speed. The speed of a gait is the speed of its animation clip (its stride over its length), so the feet do not slide.
 */
export class PersonWalker {
  x: number;
  y: number;
  heading: number;
  /** The route still to walk (the first is the next waypoint). */
  path: Point[] = [];
  gait: Locomotion = 1;
  /** Units per second for the stroll, walk and run gaits. */
  readonly speeds: [number, number, number];
  /** How fast it is going now, units per second (0 when standing). */
  speed = 0;
  /** The route ends at a prop that slows people down on approach (the game's default for props; not for the temporary prop of a wander). */
  slowApproach = false;
  /** The length of a turn on the spot, seconds (from the turn clips' frame counts). */
  turnSeconds = TURN_SECONDS;
  /** The turn in progress: the heading it started from and is going to, the time so far, and the turn clip's animation id (35 to 40). */
  private turn: { start: number; target: number; elapsed: number; clip: number } | null = null;

  constructor(x: number, y: number, heading: number, speeds: [number, number, number]) {
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.speeds = speeds;
  }

  /** Whether the walker has somewhere to go. */
  get moving(): boolean { return this.path.length > 0; }

  /** Whether a turn on the spot is playing, and its turn clip's animation id (`turnClipId`). */
  get turning(): boolean { return this.turn !== null; }
  get turnClip(): number | null { return this.turn ? this.turn.clip : null; }

  /** Start walking a route at a gait. An empty or null route stops. */
  go(path: Point[] | null, gait: Locomotion, slowApproach = false): void {
    this.path = path ? [...path] : [];
    this.gait = gait;
    this.slowApproach = slowApproach;
    this.turn = null;
    if (!this.path.length) this.speed = 0;
  }

  stop(): void { this.path = []; this.turn = null; this.speed = 0; }

  /**
   * Turn on the spot toward a heading, called every tick with that tick's `dt`; true once facing it. [read] (`StateTurning_Update`) A turn under 5 degrees is not played: the heading is set at
   * once. Otherwise the turn clip is chosen once from the whole turn (`turnClip`, for the caller to play) and the heading moves in a straight line from where it started to the target
   * over `turnSeconds`.
   */
  turnTo(target: number, dt: number): boolean {
    if (!this.turn || Math.abs(wrapAngle(this.turn.target - target)) > 1e-9) {
      const diff = wrapAngle(target - this.heading);
      const clip = turnClipId(diff);
      if (clip === null) { this.heading = wrapAngle(target); this.turn = null; return true; }
      this.turn = { start: this.heading, target, elapsed: 0, clip };
    }
    const t = this.turn;
    t.elapsed += Math.max(0, dt);
    if (t.elapsed >= this.turnSeconds) { this.heading = wrapAngle(t.target); this.turn = null; return true; }
    this.heading = lerpAngle(t.start, t.target, t.elapsed / this.turnSeconds);
    return false;
  }

  /** Put the walker somewhere (a drop, a placement): it stops. */
  place(x: number, y: number, heading = this.heading): void {
    this.x = x; this.y = y; this.heading = heading;
    this.path = [];
    this.turn = null;
    this.speed = 0;
  }

  /**
   * Advance by `dt` seconds. Returns true while it is still on its way. The walker moves toward the next waypoint at its current speed (`updateSpeed`) whatever way it faces, and its heading
   * follows the direction of travel by `STEER_PER_TICK` a tick: it does not stop to turn (see the constants). Time is taken in slices of at most one tick (0.1 s) so the speed ramps the
   * same at any frame rate.
   */
  step(dt: number): boolean {
    let left = Math.max(0, dt);
    while (this.path.length && left > 1e-9) {
      const slice = Math.min(left, TICK_SECONDS);
      left -= slice;
      this.updateSpeed(slice);
      this.advance(slice);
    }
    if (!this.path.length) this.speed = 0; // the route is empty: the game sets the speed to 0 at once
    return this.path.length > 0;
  }

  /** `PathAgent_UpdateSpeed` for `dt` seconds (see `ACCELERATION`). */
  private updateSpeed(dt: number): void {
    const max = this.speeds[this.gait];
    const min = max * MIN_SPEED_SHARE;
    const goal = this.path[this.path.length - 1]!;
    const d2 = (this.x - goal.x) ** 2 + (this.y - goal.y) ** 2;
    if (this.slowApproach && d2 < SLOW_RANGE_SQ) {
      const target = (d2 / SLOW_RANGE_SQ) * (max - min) + min;
      if (target < this.speed || this.speed <= 0) this.speed = target;
      return;
    }
    this.speed = Math.max(min, Math.min(max, this.speed + ACCELERATION * dt));
  }

  /** Move for `dt` seconds at the current speed along the route, steering the heading. */
  private advance(dt: number): void {
    let left = dt;
    while (this.path.length && left > 1e-9) {
      const target = this.path[0]!;
      const dx = target.x - this.x, dy = target.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist < REACHED) { this.path.shift(); continue; }
      if (this.speed <= 0) return;
      const step = Math.min(dist, this.speed * left);
      const used = step / this.speed;
      this.heading = lerpAngle(this.heading, Math.atan2(dy, dx), steerShare(used));
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
      left -= used;
      if (step >= dist) this.path.shift();
    }
  }
}
