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
  go(path: Point[] | null, gait: Locomotion): void {
    this.path = path ? [...path] : [];
    this.gait = gait;
    this.turn = null;
  }

  stop(): void { this.path = []; this.turn = null; }

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
  }

  /**
   * Advance by `dt` seconds. Returns true while it is still on its way. The walker moves toward the next waypoint at its gait's speed whatever way it faces, and its heading follows the
   * direction of travel by `STEER_PER_TICK` a tick: it does not stop to turn (see the constant).
   */
  step(dt: number): boolean {
    let left = Math.max(0, dt);
    while (this.path.length && left > 1e-9) {
      const target = this.path[0]!;
      const dx = target.x - this.x, dy = target.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist < REACHED) { this.path.shift(); continue; }
      const speed = this.speeds[this.gait];
      if (speed <= 0) return true;
      const step = Math.min(dist, speed * left);
      const used = step / speed;
      this.heading = lerpAngle(this.heading, Math.atan2(dy, dx), steerShare(used));
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
      left -= used;
      if (step >= dist) this.path.shift();
    }
    return this.path.length > 0;
  }
}
