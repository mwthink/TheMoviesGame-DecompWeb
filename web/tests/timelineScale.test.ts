// The timeline's date-to-x curve (docs/AUDIO.md): "now" 128 px in, 1 year back to the left edge, 20 years ahead to the right edge, a square-root-like curve.
import assert from "node:assert/strict";
import { test } from "node:test";
import { NOW_OFFSET, timelineX } from "../src/sim/ui/TimelineScale.ts";

test("now sits at the offset, the ends at the edges", () => {
  assert.equal(timelineX(0, 1000), NOW_OFFSET);
  assert.equal(timelineX(20, 1000), 1000);
  assert.equal(timelineX(-1, 1000), 0);
});

test("beyond the bar there is no position", () => {
  assert.equal(timelineX(20.5, 1000), null);
  assert.equal(timelineX(-1.01, 1000), null);
});

test("the future is compressed: one year ahead is already 37.5% of the way", () => {
  const w = 1000;
  const frac = (timelineX(1, w)! - NOW_OFFSET) / (w - NOW_OFFSET);
  assert.ok(Math.abs(frac - 0.375) < 0.002);
  assert.ok(timelineX(0.5, w)! < timelineX(1, w)! && timelineX(1, w)! < timelineX(10, w)!);
});
