// The dev menu's sun: direction maths and clamping (docs/LIGHTING.md). No game files needed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SUN, normalizeSun, sunDirection } from "../../src/world/Sun.ts";

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test("a sun due north on the horizon is toward game +y, which is scene +z; overhead is scene +y", () => {
  const north = sunDirection(0, 2);
  assert.ok(north.z > 0.99 && Math.abs(north.x) < 1e-9 && north.y > 0);
  const overhead = sunDirection(123, 90);
  assert.ok(near(overhead.y, 1) && near(overhead.x, 0) && near(overhead.z, 0));
  const east = sunDirection(90, 0.0001);
  assert.ok(east.x > 0.99); // east is game +x = scene +x
});

test("the direction is a unit vector", () => {
  for (const [az, el] of [[0, 10], [200, 45], [359, 80]] as const) {
    const d = sunDirection(az, el);
    assert.ok(near(Math.hypot(d.x, d.y, d.z), 1));
  }
});

test("settings are clamped and the azimuth wraps", () => {
  const s = normalizeSun({ azimuth: -90, elevation: 200, intensity: -1, baked: 9 });
  assert.equal(s.azimuth, 270);
  assert.equal(s.elevation, 90);
  assert.equal(s.intensity, 0);
  assert.equal(s.baked, 2);
  assert.deepEqual(normalizeSun({}), DEFAULT_SUN);
});
