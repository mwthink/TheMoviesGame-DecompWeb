import type { NavGrid, Point } from "../nav/NavGrid.ts";
import type { Locomotion } from "../anim/Gaits.ts";

/**
 * Idle wandering for people who are not busy in a room (docs/MOVEMENT.md): stand for a few seconds, pick somewhere to stroll to nearby, walk there, repeat. [guess] This is not
 * the game's AI (people there act on desires, `CDesire` / `CActivity`, `TMCharacter_TryReplaceActionWithBetterDesire`); it is a stand-in that makes the lot's loose people move.
 */
export interface WanderPlan { to: Point[]; gait: Locomotion; }

export class Wanderer {
  /** Seconds until the next trip. */
  private wait: number;
  private readonly random: () => number;

  constructor(random: () => number = Math.random, firstWait?: number) {
    this.random = random;
    this.wait = firstWait ?? this.pause();
  }

  private pause(): number { return 2 + this.random() * 6; }

  /**
   * Advance by `dt` seconds while the person is standing. Returns a route when it is time to go somewhere (and starts the next wait), else null. The destination is a walkable point
   * between 6 and 30 units away that has a route.
   */
  update(dt: number, from: Point, nav: NavGrid): WanderPlan | null {
    this.wait -= dt;
    if (this.wait > 0) return null;
    this.wait = this.pause();
    for (let tries = 0; tries < 8; tries++) {
      const angle = this.random() * Math.PI * 2;
      const dist = 6 + this.random() * 24;
      const to = { x: from.x + Math.cos(angle) * dist, y: from.y + Math.sin(angle) * dist };
      if (nav.isBlocked(to.x, to.y)) continue;
      const path = nav.findPath(from, to);
      if (path && path.length) return { to: path, gait: 0 };
    }
    return null;
  }
}
