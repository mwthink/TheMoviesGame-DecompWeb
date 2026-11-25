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

import { DEFAULT_SHADOWS, normalizeShadows, shadowMatrix } from "../../src/world/Sun.ts";

/** p * M for a row-vector matrix in Babylon's layout. */
const apply = (m: number[], p: { x: number; y: number; z: number }) => ({
  x: p.x * m[0]! + p.y * m[4]! + p.z * m[8]! + m[12]!,
  y: p.x * m[1]! + p.y * m[5]! + p.z * m[9]! + m[13]!,
  z: p.x * m[2]! + p.y * m[6]! + p.z * m[10]! + m[14]!,
});

test("the shadow matrix puts the whole lot inside the unit cube, with depth growing away from the sun", () => {
  const box = { min: { x: -192, y: 0, z: -128 }, max: { x: 192, y: 45, z: 256 } };
  const toSun = sunDirection(135, 50);
  const { m, depthRange } = shadowMatrix(toSun, box);
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = apply(m, { x, y, z });
    for (const v of [p.x, p.y, p.z]) assert.ok(v > -1e-9 && v < 1 + 1e-9, `corner ${x},${y},${z} -> ${p.x},${p.y},${p.z}`);
  }
  const low = { x: 0, y: 0, z: 0 };
  const towardSun = { x: low.x + toSun.x * 10, y: low.y + toSun.y * 10, z: low.z + toSun.z * 10 };
  assert.ok(apply(m, towardSun).z < apply(m, low).z); // closer to the sun = smaller depth
  assert.ok(depthRange > 100);
});

test("a sun straight overhead still gives a usable frame", () => {
  const { m } = shadowMatrix(sunDirection(0, 90), { min: { x: -10, y: 0, z: -10 }, max: { x: 10, y: 10, z: 10 } });
  assert.ok(m.every((v) => Number.isFinite(v)));
});

test("shadow settings are clamped", () => {
  assert.equal(normalizeShadows({ darkness: 7, bias: -1, size: 1000 as 2048 }).darkness, 1);
  assert.equal(normalizeShadows({ bias: -1 }).bias, 0);
  assert.equal(normalizeShadows({ size: 2048 }).size, 2048);
  assert.equal(normalizeShadows({ size: 1000 as 2048 }).size, 4096);
  assert.deepEqual(normalizeShadows({}), DEFAULT_SHADOWS);
});

import { skyVariantForHour } from "../../src/world/Sky.ts";
import { GameClock } from "../../src/sim/core/GameClock.ts";

test("the sky variant follows the game's hour thresholds: night to 5, morning 6 to 9, day from 10", () => {
  assert.deepEqual([0, 3, 5].map(skyVariantForHour), [0, 0, 0]);
  assert.deepEqual([6, 8, 9].map(skyVariantForHour), [1, 1, 1]);
  assert.deepEqual([10, 14, 23].map(skyVariantForHour), [2, 2, 2]);
});

test("the dev time scale multiplies the game speed", () => {
  const clock = new GameClock(1960 * 365);
  clock.timeScale = 5;
  assert.equal(clock.advance(0.1), 5);
  clock.timeScale = 0.1;
  assert.equal(clock.advance(1), 1);
  clock.speed = "pause";
  clock.timeScale = 10;
  assert.equal(clock.advance(10), 0);
});
