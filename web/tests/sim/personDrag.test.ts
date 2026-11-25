// The rules for carrying a person (docs/DRAGGING.md). No game files needed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CLICK_MS, DRAG_START_PX, RETURN_MAX_STEP, holdBegins, hoverLift, hoverYaw, returnStep } from "../../src/sim/ui/PersonDrag.ts";

test("a press is a click until it has been held 250 ms or the pointer has moved", () => {
  assert.equal(CLICK_MS, 250);
  assert.equal(holdBegins(100, 0), false);
  assert.equal(holdBegins(250, 0), true);
  assert.equal(holdBegins(50, DRAG_START_PX + 1), true);
});

test("a held person bobs between 0 and half a unit and sways a third of a radian", () => {
  for (let ms = 0; ms < 20000; ms += 137) {
    const lift = hoverLift(ms);
    assert.ok(lift >= -1e-9 && lift <= 0.5 + 1e-9);
    assert.ok(Math.abs(hoverYaw(ms)) <= 0.3 + 1e-9);
  }
  assert.ok(Math.abs(hoverLift(0) - 0.25) < 1e-9);
});

test("the return moves 10 units a tick, arrives in one step from under 10 away, and snaps within 2", () => {
  const far = returnStep({ x: 0, y: 0 }, { x: 100, y: 0 });
  assert.deepEqual([far.x, far.y, far.done], [RETURN_MAX_STEP, 0, false]);
  const near = returnStep({ x: 0, y: 0 }, { x: 6, y: 8 }); // 10 away: lands on the target but is not done yet
  assert.ok(Math.abs(near.x - 6) < 1e-9 && Math.abs(near.y - 8) < 1e-9 && near.done === false);
  const snap = returnStep({ x: 5, y: 5 }, { x: 5.5, y: 5.5 });
  assert.deepEqual([snap.x, snap.y, snap.done], [5.5, 5.5, true]);
  let p = { x: 0, y: 0 }, steps = 0;
  for (;;) { const s = returnStep(p, { x: 57, y: 0 }); p = s; steps++; if (s.done) break; }
  assert.ok(steps >= 6 && steps <= 8, `${steps} steps`);
});
