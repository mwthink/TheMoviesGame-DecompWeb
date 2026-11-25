// The tooltip's hover-stillness fade (orig 0x0078EB40) and wrap width. No game files needed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { HoverStillness, tooltipWidth } from "../../src/ui/Tooltip.ts";

test("appears after 0.2 s of stillness and is opaque after 1.2 s", () => {
  const s = new HoverStillness();
  s.tick(10, 10); // the first position counts as a move
  assert.equal(s.opacity, 0);
  s.tick(10, 10); s.tick(10, 10);
  assert.equal(s.opacity, 0); // -0.2 + 0.2, not above 0 yet
  s.tick(10, 10);
  assert.ok(s.opacity > 0 && s.opacity < 0.2);
  for (let i = 0; i < 20; i++) s.tick(10, 10);
  assert.equal(s.opacity, 1);
});

test("moving the pointer restarts the wait", () => {
  const s = new HoverStillness();
  for (let i = 0; i < 20; i++) s.tick(5, 5);
  assert.equal(s.opacity, 1);
  s.tick(6, 5);
  assert.equal(s.value, -0.2);
  assert.equal(s.opacity, 0);
});

test("wrap width is 90 % of the room left", () => {
  assert.equal(tooltipWidth(1000), 900);
  assert.equal(tooltipWidth(50), 120);
});
