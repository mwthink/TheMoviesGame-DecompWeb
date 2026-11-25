// Person movement: gait tables, the walking grid, the walker and the wanderer (docs/MOVEMENT.md).
import assert from "node:assert/strict";
import { test } from "node:test";
import { anmSpeed } from "../../src/formats/Anm.ts";
import { Wanderer } from "../../src/sim/ai/Wander.ts";
import { ANIM_IDS, defaultGaits, gaitClipFile, locomotionForUrgency, parseGaitIni, turnClipId, turnSeconds } from "../../src/sim/anim/Gaits.ts";
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
  assert.ok(Math.abs(w.x - 1.45) < 1e-9 && Math.abs(w.y) < 1e-9); // 1 s: from half the gait's 2 units/s, up 0.1 a tick (1 + 1.1 + ... + 1.9, times 0.1 s)
  assert.equal(w.moving, true);
  assert.equal(w.step(10), false);
  assert.ok(Math.abs(w.x - 10) < 1e-6);

  const t = new PersonWalker(0, 0, Math.PI, [1, 2, 4]); // facing away: the game does not stop to turn, it steers while it moves
  t.go([{ x: 10, y: 0 }], 2);
  t.step(0.1);
  assert.ok(t.x > 0.15, "moves at once"); // 0.2 units in a tick at gait 2 (4 units a second is 0.4)
  assert.ok(Math.abs(wrapAngle(t.heading - Math.PI)) > 0.5 && Math.abs(wrapAngle(t.heading)) > 0.5, "still swinging round");
  while (t.step(0.1));
  assert.ok(Math.abs(t.x - 10) < 0.15 && Math.abs(wrapAngle(t.heading)) < 0.05, `ends facing its way: ${t.x} ${t.heading}`); // a waypoint counts as reached within 0.15

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

test("steering: the heading closes 35 % of the way to the direction of travel each tick, whatever the frame rate", () => {
  const a = new PersonWalker(0, 0, Math.PI / 2, [1, 2, 4]); // facing +y, going along +x: 90 degrees off
  a.go([{ x: 100, y: 0 }], 1);
  a.step(0.1);
  assert.ok(Math.abs(a.heading - (Math.PI / 2) * 0.65) < 1e-9, `one tick: ${a.heading}`);
  const b = new PersonWalker(0, 0, Math.PI / 2, [1, 2, 4]);
  b.go([{ x: 100, y: 0 }], 1);
  for (let i = 0; i < 10; i++) b.step(0.01); // the same tenth of a second in ten frames
  assert.ok(Math.abs(b.heading - a.heading) < 1e-9, `${b.heading} vs ${a.heading}`);
});

test("the turn clip is chosen from target minus start: sign, size, and nothing under 5 degrees", () => {
  const deg = (d: number) => (d * Math.PI) / 180;
  assert.equal(turnClipId(deg(4.9)), null);
  assert.equal(turnClipId(deg(-4.9)), null);
  assert.deepEqual([6, 11.9, 12, 35.9, 36, 170].map((d) => turnClipId(deg(d))), [35, 35, 36, 36, 37, 37]); // positive: A_TURN_POS_10, 22, 45
  assert.deepEqual([-6, -12, -36].map((d) => turnClipId(deg(d))), [38, 39, 40]); // negative: A_TURN_NEG_*
  assert.equal(turnClipId(0), null);
});

test("a turn takes frames x 100 ms: 0.7 s for the six turn clips, moving the heading in a straight line", () => {
  assert.equal(turnSeconds({ nFrames: 19, flags: 3 }), 0.7); // (19 - 1) / 3 + 1 = 7 frames
  assert.equal(turnSeconds({ nFrames: 19, flags: 0 }), 1.9); // without the flag every stored frame counts
  const w = new PersonWalker(0, 0, 0, [1, 2, 4]);
  const target = (90 * Math.PI) / 180;
  assert.equal(w.turnTo(target, 0.1), false);
  assert.equal(w.turnClip, 37); // 90 degrees: the 45-degree clip, positive
  assert.ok(Math.abs(w.heading - target * (0.1 / 0.7)) < 1e-9);
  for (let i = 0; i < 2; i++) w.turnTo(target, 0.1);
  assert.ok(Math.abs(w.heading - target * (0.3 / 0.7)) < 1e-9, "linear, not eased");
  assert.equal(w.turnClip, 37, "the same clip for the whole turn");
  for (let i = 0; i < 3; i++) w.turnTo(target, 0.1);
  assert.equal(w.turnTo(target, 0.11), true); // 0.3 + 0.3 + 0.11 > 0.7
  assert.equal(w.heading, target);
  assert.equal(w.turning, false);
  assert.equal(w.turnClip, null);
});

test("a turn goes the short way round, a small one is not played, and moving or stopping ends it", () => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const w = new PersonWalker(0, 0, rad(170), [1, 2, 4]);
  w.turnTo(rad(-170), 0.1); // 20 degrees across the wrap: counter-clockwise, not 340 the other way
  assert.equal(w.turnClip, 36);
  assert.ok(wrapAngle(w.heading - rad(170)) > 0 && wrapAngle(w.heading - rad(170)) < rad(5));
  w.stop();
  assert.equal(w.turning, false);
  const s = new PersonWalker(0, 0, 0, [1, 2, 4]);
  assert.equal(s.turnTo(rad(3), 0.1), true); // under 5 degrees: set at once, no clip
  assert.ok(Math.abs(s.heading - rad(3)) < 1e-12 && s.turnClip === null);
  const g = new PersonWalker(0, 0, 0, [1, 2, 4]);
  g.turnTo(rad(90), 0.1);
  g.go([{ x: 5, y: 0 }], 1);
  assert.equal(g.turning, false);
});

test("speed: half the gait's speed at once from rest, then +1 unit/s each second up to the gait's, whatever the frame rate", () => {
  const a = new PersonWalker(0, 0, 0, [1, 2, 4]);
  a.go([{ x: 1000, y: 0 }], 2); // gait speed 4, so half is 2
  assert.equal(a.speed, 0);
  a.step(0.1);
  assert.equal(a.speed, 2, "the first tick is at the minimum, half of 4"); // 0 + 0.1 is under it
  a.step(0.1);
  assert.ok(Math.abs(a.speed - 2.1) < 1e-9, `second tick: ${a.speed}`);
  // 0.2 s in two game ticks, or in twenty small frames: the same ramp to within the quantisation of a 0.1 s tick
  const b = new PersonWalker(0, 0, 0, [1, 2, 4]);
  b.go([{ x: 1000, y: 0 }], 2);
  for (let i = 0; i < 20; i++) b.step(0.01);
  assert.ok(Math.abs(b.speed - a.speed) < 0.12 && Math.abs(b.x - a.x) < 0.05, `${b.speed} ${b.x} vs ${a.speed} ${a.x}`);
  for (let i = 0; i < 40; i++) a.step(0.1);
  assert.equal(a.speed, 4); // capped at the gait's speed
});

test("speed: stopping is immediate, and a route that ends sets the speed to 0", () => {
  const w = new PersonWalker(0, 0, 0, [1, 2, 4]);
  w.go([{ x: 1000, y: 0 }], 1);
  w.step(0.5);
  assert.ok(w.speed > 0);
  w.stop();
  assert.equal(w.speed, 0);
  w.go([{ x: 0.5, y: 0 }], 1);
  while (w.step(0.1));
  assert.equal(w.speed, 0);
  w.go([{ x: 1000, y: 0 }], 1);
  w.step(0.2);
  w.go(null, 1); // an empty route
  assert.equal(w.speed, 0);
});

test("speed: near a prop that slows people down it eases to half the gait's speed at the goal, and only ever down", () => {
  const goal = { x: 30, y: 0 };
  const slow = new PersonWalker(0, 0, 0, [1, 2, 4]);
  slow.go([goal], 2, true);
  const fast = new PersonWalker(0, 0, 0, [1, 2, 4]);
  fast.go([goal], 2, false);
  let lowest = Infinity, prev = Infinity;
  for (let i = 0; i < 400 && slow.moving; i++) {
    slow.step(0.05);
    fast.step(0.05);
    const d2 = (goal.x - slow.x) ** 2;
    if (d2 < 2.5) { // clearly inside the zone (the speed is set from the distance at the start of the slice)
      assert.ok(slow.speed <= prev + 1e-9, "never speeds up inside the zone");
      assert.ok(slow.speed <= (((Math.sqrt(d2) + 0.25) ** 2) / 3) * 2 + 2, `eased down to the target of the slice's start: ${slow.speed}`); // up to 0.25 units earlier
      prev = slow.speed;
    }
    if (slow.moving) lowest = Math.min(lowest, slow.speed); // not the 0 of arriving
  }
  assert.ok(lowest >= 2 - 1e-9 && lowest < 2.5, `ends at half speed, ${lowest}`); // half of 4
  assert.ok(fast.speed === 0 || fast.speed === 4, "without the flag it keeps full speed until the route ends");
});
