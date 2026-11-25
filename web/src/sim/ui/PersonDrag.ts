/**
 * Picking a person up with the mouse and putting them down: the rules, as numbers (docs/DRAGGING.md). The scene work is `world/PersonDragger.ts`.
 *
 * What the original does [read], with the function each number comes from:
 *   - a press and release within 250 ms is a click (`TMInWorld_UpdateInputState`, orig 0x00539BE0, `0xFA`; `TMInWorld_UpdateClick`, orig 0x00539AF0, allows 350 ms); a press held
 *     longer is a hold, and a held person is picked up (`TMCharacter_BeginPlayerPickup`, orig 0x0059A980, `TMMobile_BeginDrag`, orig 0x0053BD70);
 *   - while held, the person follows the point where the mouse ray meets the ground (`TMMobile_UpdateDragTargetFromCursor`, orig 0x0053ABE0, `TMCharacter_SnapToDragTarget`,
 *     orig 0x00599A40), bobbing and swaying a little (`TMMobile_UpdateHoverBob`, orig 0x0053A9E0);
 *   - a drop that is not allowed sends the person back to where they were picked up, moving toward it 10 units per 0.1 s tick and snapping when within 2
 *     (`TMMobile_UpdateDragMotion`, orig 0x0053A3A0); an allowed drop leaves them there (`TMMobile_EndDrag`, orig 0x0053C260, after `TMMobile_CanDropHere`, orig 0x0053A560).
 */

/** A press released within this many milliseconds is a click; held longer it is a hold. */
export const CLICK_MS = 250;

/** [guess] How far the pointer may move (pixels) before a press counts as a drag even if it was quick: the original compares only time, but a mouse that moves is dragging. */
export const DRAG_START_PX = 6;

/** Whether a press that has lasted `heldMs` and moved `movedPx` has become a drag. */
export function holdBegins(heldMs: number, movedPx: number): boolean {
  return heldMs >= CLICK_MS || movedPx > DRAG_START_PX;
}

/**
 * The height a held person hangs above the ground. `TMMobile_UpdateHoverBob`: `0.25 + 0.25 * sin(ms * 0.0025)` added to the height the cursor target gives (0 on the ground),
 * `ms` being the millisecond clock: between 0 and 0.5 units, one bob every 2.5 seconds.
 */
export function hoverLift(ms: number): number {
  return 0.25 + 0.25 * Math.sin(ms * 0.0025);
}

/** The sway of a held person: `0.3 * sin(ms * 0.0016)` radians added to their facing (`TMMobile_UpdateHoverBob`). [guess] that it is applied as an offset, not accumulated. */
export function hoverYaw(ms: number): number {
  return 0.3 * Math.sin(ms * 0.0016);
}

/** Seconds between the steps of a return (the simulation tick). */
export const RETURN_TICK_SECONDS = 0.1;
/** Farthest one return step goes, in units. */
export const RETURN_MAX_STEP = 10;
/** Within this distance the person snaps to the target and the return is done. */
export const RETURN_SNAP = 2;

/**
 * One step of the return to the pick-up spot, `TMMobile_UpdateDragMotion`: from 2 or more units away the person moves toward the target by the smaller of the distance and 10
 * units (so from under 10 units away they arrive in one step); within 2 units they snap to it and the return is done.
 */
export function returnStep(pos: { x: number; y: number }, target: { x: number; y: number }): { x: number; y: number; done: boolean } {
  const dx = target.x - pos.x, dy = target.y - pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist < RETURN_SNAP) return { x: target.x, y: target.y, done: true };
  const step = Math.min(dist, RETURN_MAX_STEP);
  return { x: pos.x + (dx / dist) * step, y: pos.y + (dy / dist) * step, done: false };
}
