// Flying the loading scene's backdrop camera (docs/LOADING_SCREENS.md, "The scene editor").
import assert from "node:assert/strict";
import { test } from "node:test";
import { aimOf, centreView, extent, forward, lookFrom, move, overview, right, turn, type Cam } from "../src/screens/loadingCameraMath.ts";

const near = (a: readonly number[], b: readonly number[], eps = 1e-9) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]!) < eps, `${a} vs ${b}`));

test("yaw 0 looks along +y with +x to the right; a quarter turn right looks along +x", () => {
  near(forward(0, 0), [0, 1, 0]);
  near(right(0), [1, 0, 0]);
  near(forward(Math.PI / 2, 0), [1, 0, 0]);
  near(right(Math.PI / 2), [0, -1, 0]);
  near(forward(0, Math.PI / 2), [0, 0, 1]);
});

test("aimOf and lookFrom are inverses", () => {
  const c: Cam = { eye: [1, 8, 2.2], look: [0, -4, 1.8] };
  const a = aimOf(c);
  const back = lookFrom(c.eye, a.yaw, a.pitch, a.dist);
  near(back.look, c.look, 1e-9);
});

test("turning keeps the eye and the distance, and the pitch stops short of straight up or down", () => {
  const c: Cam = { eye: [0, 0, 2], look: [0, 10, 2] };
  const t = turn(c, Math.PI / 2, 0.2);
  near(t.eye, c.eye);
  assert.ok(Math.abs(aimOf(t).dist - 10) < 1e-9);
  assert.ok(t.look[0] > 9 && t.look[2] > 2);
  const up = turn(c, 0, 10);
  assert.ok(aimOf(up).pitch < Math.PI / 2 && aimOf(up).pitch > 1.4);
});

test("moving shifts eye and look together along the view, to the side and up", () => {
  const c: Cam = { eye: [0, 0, 2], look: [0, 10, 2] };
  near(move(c, 3, 0, 0).eye, [0, 3, 2]);
  near(move(c, 0, 2, 0).eye, [2, 0, 2]);
  const m = move(c, 0, 0, 1.5);
  near(m.eye, [0, 0, 3.5]);
  near([m.look[0] - m.eye[0], m.look[1] - m.eye[1], m.look[2] - m.eye[2]], [0, 10, 0]);
});

test("the overview is inside the top of the set's box looking down at its middle; the centre view stands inside it", () => {
  const b = { min: [-8, -6, 0] as [number, number, number], max: [8, 10, 6] as [number, number, number] };
  assert.equal(extent(b), 16);
  const o = overview(b);
  assert.ok(o.eye[2] < b.max[2] && o.eye[2] > 4 && aimOf(o).pitch < -0.3 && aimOf(o).yaw === 0);
  const c = centreView(b);
  near(c.eye, [0, 2, 1.7]);
});
