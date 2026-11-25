// Person movement: gait tables, the walking grid, the walker and the wanderer (docs/MOVEMENT.md).
import assert from "node:assert/strict";
import { test } from "node:test";
import { anmSpeed } from "../../src/formats/Anm.ts";
import { Wanderer } from "../../src/sim/ai/Wander.ts";
import { ANIM_IDS, defaultGaits, gaitClipFile, locomotionForUrgency, parseGaitIni } from "../../src/sim/anim/Gaits.ts";
import { PersonWalker, wrapAngle } from "../../src/sim/anim/Walker.ts";
import { NavGrid } from "../../src/sim/nav/NavGrid.ts";

test("a clip's speed is its stride over its length", () => {
  assert.ok(Math.abs(anmSpeed({ nFrames: 31, flags: 3, stride: 1.674 }) - 1.674) < 1e-9); // 31 frames of a flag-3 clip last 1.0 s
  assert.equal(anmSpeed({ nFrames: 31, flags: 0, stride: 0 }), 0);
});

test("gaits: defaults by sex, urgency thresholds, gait.ini lookup", () => {
  assert.deepEqual(defaultGaits(false), { stroll: 9, walk: 0, run: 10 });
  assert.deepEqual(defaultGaits(true), { stroll: 20, walk: 11, run: 21 });
  assert.equal(defaultGaits(true, true).walk, 12);
  assert.deepEqual([0.1, 0.3, 0.69, 0.7, 1].map(locomotionForUrgency), [0, 1, 1, 2, 2]);
  assert.equal(ANIM_IDS.length, 48);
  const ini = parseGaitIni(`${ANIM_IDS[0]} = Walk.anm\r\n; comment\r\n${ANIM_IDS[10]}=run_jog.anm`);
  assert.equal(gaitClipFile(ini, 0), "walk.anm");
  assert.equal(gaitClipFile(ini, 10), "run_jog.anm");
  assert.equal(gaitClipFile(ini, 5), undefined);
});

function openGrid(): NavGrid {
  const nav = new NavGrid();
  nav.openRect(-50, -50, 50, 50);
  // a wall across x = 0 from y = -50 to 30, leaving a gap at the top
  nav.blockTriangles([[{ x: -1, y: -50 }, { x: 1, y: -50 }, { x: 1, y: 30 }], [{ x: -1, y: -50 }, { x: 1, y: 30 }, { x: -1, y: 30 }]]);
  return nav;
}

test("the grid blocks footprints and routes around them", () => {
  const nav = openGrid();
  assert.ok(nav.isBlocked(0, 0));
  assert.ok(nav.isBlocked(200, 0)); // outside the lot
  assert.ok(!nav.isBlocked(-20, 0));
  assert.ok(!nav.lineClear({ x: -20, y: 0 }, { x: 20, y: 0 }));
  const path = nav.findPath({ x: -20, y: 0 }, { x: 20, y: 0 })!;
  assert.ok(path && path.length >= 2);
  const end = path[path.length - 1]!;
  assert.ok(Math.hypot(end.x - 20, end.y) < 2);
  assert.ok(path.some((p) => p.y > 28)); // goes round by the gap
  for (const p of path) assert.ok(!nav.isBlocked(p.x, p.y));
});

test("a walker turns, walks at its gait's speed and arrives", () => {
  const w = new PersonWalker(0, 0, 0, [1, 2, 4]);
  w.go([{ x: 10, y: 0 }], 1);
  for (let i = 0; i < 10; i++) w.step(0.1);
  assert.ok(Math.abs(w.x - 2) < 1e-6 && Math.abs(w.y) < 1e-9); // 1 s at 2 units/s, already facing the way
  assert.equal(w.moving, true);
  assert.equal(w.step(10), false);
  assert.ok(Math.abs(w.x - 10) < 1e-6);

  const t = new PersonWalker(0, 0, Math.PI, [1, 2, 4]); // facing away: turns on the spot first
  t.go([{ x: 10, y: 0 }], 2);
  t.step(0.2);
  assert.equal(t.x, 0);
  assert.ok(Math.abs(wrapAngle(t.heading - Math.PI)) > 0.1);
  while (t.step(0.1));
  assert.ok(Math.abs(t.x - 10) < 1e-6 && Math.abs(wrapAngle(t.heading)) < 1e-6);

  t.place(3, 4);
  assert.equal(t.moving, false);
});

test("the wanderer waits, then picks a reachable spot", () => {
  const nav = openGrid();
  let n = 0;
  const w = new Wanderer(() => ((n++ * 0.37) % 1), 1);
  assert.equal(w.update(0.5, { x: -20, y: 0 }, nav), null);
  const plan = w.update(1, { x: -20, y: 0 }, nav);
  assert.ok(plan && plan.to.length > 0);
  for (const p of plan.to) assert.ok(!nav.isBlocked(p.x, p.y));
});
