import type { Point } from "../nav/NavGrid.ts";
import type { Locomotion } from "./Gaits.ts";

/** How fast a walker turns toward its way, radians per second. [guess] (the game turns with clips from 5 degrees up, `TMCharacter_PlayTurnAnimation`, which are not played here.) */
export const TURN_RATE = 4.5;
/** A walker only moves forward while its heading is within this of the way (radians); otherwise it turns on the spot first. */
const ALIGNED = (50 * Math.PI) / 180;
/** Closer than this to a waypoint counts as having reached it. */
const REACHED = 0.15;

/** Wrap an angle to (-pi, pi]. */
export function wrapAngle(a: number): number {
  const t = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return t === -Math.PI ? Math.PI : t;
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

  constructor(x: number, y: number, heading: number, speeds: [number, number, number]) {
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.speeds = speeds;
  }

  /** Whether the walker has somewhere to go. */
  get moving(): boolean { return this.path.length > 0; }

  /** Start walking a route at a gait. An empty or null route stops. */
  go(path: Point[] | null, gait: Locomotion): void {
    this.path = path ? [...path] : [];
    this.gait = gait;
  }

  stop(): void { this.path = []; }

  /** Turn on the spot toward a heading for `dt` seconds (at the walker's turn rate); true once facing it. */
  turnTo(target: number, dt: number): boolean {
    const delta = wrapAngle(target - this.heading);
    const turn = Math.min(Math.abs(delta), TURN_RATE * Math.max(0, dt));
    this.heading = wrapAngle(this.heading + Math.sign(delta) * turn);
    return Math.abs(wrapAngle(target - this.heading)) < 1e-6;
  }

  /** Put the walker somewhere (a drop, a placement): it stops. */
  place(x: number, y: number, heading = this.heading): void {
    this.x = x; this.y = y; this.heading = heading;
    this.path = [];
  }

  /** Advance by `dt` seconds. Returns true while it is still on its way. */
  step(dt: number): boolean {
    let left = Math.max(0, dt);
    while (this.path.length && left > 1e-9) {
      const target = this.path[0]!;
      const dx = target.x - this.x, dy = target.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist < REACHED) { this.path.shift(); continue; }
      // turn toward the waypoint
      const want = Math.atan2(dy, dx);
      const delta = wrapAngle(want - this.heading);
      const turn = Math.min(Math.abs(delta), TURN_RATE * left);
      this.heading = wrapAngle(this.heading + Math.sign(delta) * turn);
      if (Math.abs(delta) > ALIGNED) {
        left -= turn / TURN_RATE; // turning on the spot uses the time the turn takes
        continue;
      }
      const speed = this.speeds[this.gait];
      if (speed <= 0) return true;
      const step = Math.min(dist, speed * left);
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
      left -= step / speed;
      if (step >= dist) this.path.shift();
    }
    return this.path.length > 0;
  }
}
