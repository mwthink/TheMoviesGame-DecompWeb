// Desires, explainers and the desire agent (docs/DESIRES.md).
import assert from "node:assert/strict";
import { test } from "node:test";
import { DESIRE_UPDATE_SECONDS, DesireAgent, IDLE_THRESHOLD, TRY_START_SECONDS, USE_SECONDS, type Activity, type Actor } from "../../src/sim/ai/DesireAgent.ts";
import { Desire, parseDesires } from "../../src/sim/ai/Desires.ts";
import { PropExplainer, explainerGoal, parseExplainer, parsePlacedExplainers } from "../../src/sim/ai/Explainers.ts";
import { PersonWalker } from "../../src/sim/anim/Walker.ts";
import { NavGrid } from "../../src/sim/nav/NavGrid.ts";
import { readFileSync } from "node:fs";
import { parseSave } from "../../src/formats/Jad.ts";
import { loadWorldData } from "../../src/world/WorldData.ts";
import { findSave, haveGame, pakIndex } from "../helpers.ts";

const QUICK = findSave("QUICKSTART");

// Invented rows in the file's format (not the game's numbers).
const DESIRES = `name,fixeddesire,maxdesire,increment,fixedurgency,iconfirst,iconlast,grudgevalue,grudgerecover,desperationscene,facial
readyposition,0.9,,,,,,,,,
buyfood,,0.8,0.001,,1,2,,,scene_a.flm,
crap_male,,0.7,0.002,,3,3,,,scene_b.flm,
crap_female,,0.7,0.002,,3,3,,,scene_b.flm,
rehearse ,,,,0.5,,,,,,
urgent,,,,1,,,,,,
urgent,,,,,,,,,,
`;

// Invented explainers in the file's format.
const LOO = `interaction = test_use.flm
queueinteraction = test_queue.flm
interactive = 1
[action]
	[action/crap_male]
		[action/crap_male/thoughts]
			enroute = SOME_TEXT
		[action/crap_male/cost]
			distancecost = 1
			queuecost = 4
			nicenesscost = 10
[pos]
LocalPositionX=1.5
LocalPositionY=-4
LocalPositionZ=0
LocalAngle=1.2
`;

const BIN = `interaction = test_bin.flm
queueable = 0
range = 10
[action]
	[action/disposeoflitter]
		[action/disposeoflitter/cost]
			distancecost = 1
			queuecost = 5
[pos]
LocalPositionX=-0.6
LocalPositionY=-0.6
LocalPositionZ=0
LocalAngle=0
`;

const TOILET_FACILITY = `mesh = fac_toilet3.msh
[extra_info]
[extra_info/explainer]
	waitforall = 1
	[extra_info/explainer/male_portaloo]
		position = -1,-2
		queue = 0,-1
		offset = 0.5 -0.25
		queueangle = 1.55
	[extra_info/explainer/female_portaloo]
		offset = 0,0
		angle = 0.5
`;

test("the desire table: blanks are undefined, names are trimmed, the first of a repeated name wins", () => {
  const t = parseDesires(DESIRES);
  assert.equal(t.size, 6);
  assert.deepEqual(t.get("crap_male"), { name: "crap_male", fixedDesire: undefined, maxDesire: 0.7, increment: 0.002, fixedUrgency: undefined });
  assert.equal(t.get("readyposition")!.fixedDesire, 0.9);
  assert.ok(t.has("rehearse"));
  assert.equal(t.get("urgent")!.fixedUrgency, 1);
});

test("a desire starts in the read range, grows toward 1 by its increment, stops at its cap and resets to 0", () => {
  const t = parseDesires(DESIRES);
  assert.equal(new Desire(t.get("crap_male")!, () => 0).level, 0.2);
  assert.ok(Math.abs(new Desire(t.get("crap_male")!, () => 1).level - 0.5) < 1e-12);
  assert.ok(Math.abs(new Desire(t.get("buyfood")!, () => 0).level - 0.15) < 1e-12);
  assert.equal(new Desire(t.get("readyposition")!).level, 0.9); // a fixed desire: no starting range
  const d = new Desire(t.get("crap_male")!, () => 0.5); // 0.35
  d.tick();
  assert.ok(Math.abs(d.level - (0.35 + 0.65 * 0.002)) < 1e-12);
  for (let i = 0; i < 200000; i++) d.tick();
  assert.equal(d.level, 0.7); // capped at maxdesire
  d.reset();
  assert.equal(d.level, 0);
  const fixed = new Desire(t.get("readyposition")!);
  fixed.tick();
  assert.equal(fixed.level, 0.9); // fixed desires do not grow
});

test("an explainer file: keys, local pose, actions with their cost weights", () => {
  const loo = parseExplainer("Male_Loo", LOO);
  assert.equal(loo.name, "male_loo");
  assert.equal(loo.interaction, "test_use.flm");
  assert.equal(loo.queueable, true); // no key: queueable
  assert.equal(loo.range, undefined);
  assert.deepEqual([loo.local.x, loo.local.y, loo.local.z], [1.5, -4, 0]);
  assert.ok(Math.abs(loo.local.angle - 1.2) < 1e-9);
  assert.deepEqual([...loo.actions], [["crap_male", { distance: 1, queue: 4, niceness: 10 }]]);
  const bin = parseExplainer("trashbin", BIN);
  assert.equal(bin.queueable, false);
  assert.equal(bin.range, 10);
});

test("a placed object's explainers: names, offsets in either notation, angle", () => {
  const refs = parsePlacedExplainers(TOILET_FACILITY);
  assert.deepEqual(refs, [
    { name: "male_portaloo", offset: { x: 0.5, y: -0.25 }, angle: 0 },
    { name: "female_portaloo", offset: { x: 0, y: 0 }, angle: 0.5 },
  ]);
});

test("the goal is the local position plus the offset, turned by the prop's yaw and moved to the prop", () => {
  const loo = parseExplainer("male_loo", LOO);
  const g = explainerGoal(loo, { name: "male_loo", offset: { x: 0.5, y: 0 }, angle: 0.3 }, { x: 10, y: 20, yaw: 0 });
  assert.ok(Math.abs(g.x - 12) < 1e-9 && Math.abs(g.y - 16) < 1e-9); // (1.5 + 0.5, -4)
  assert.ok(Math.abs(g.heading - 1.5) < 1e-9); // 0 + 1.2 + 0.3
  const turned = explainerGoal(loo, { name: "male_loo", offset: { x: 0.5, y: 0 }, angle: 0 }, { x: 10, y: 20, yaw: Math.PI / 2 });
  assert.ok(Math.abs(turned.x - 14) < 1e-9 && Math.abs(turned.y - 22) < 1e-9); // (2, -4) turned a quarter: (4, 2)
});

test("the cost: weights, range, busy props that cannot be queued for, the cooldown", () => {
  const loo = new PropExplainer(parseExplainer("male_loo", LOO), { name: "male_loo", offset: { x: 0, y: 0 }, angle: 0 }, { x: 0, y: 0, yaw: 0 }); // goal (1.5, -4)
  const at = (x: number, y: number) => loo.cost("crap_male", x, y, 0, 1)!;
  assert.ok(Math.abs(at(1.5, -14) - 10) < 1e-9); // 10 units away, no queue, niceness 1
  loo.users = 2;
  assert.ok(Math.abs(at(1.5, -14) - 18) < 1e-9); // two ahead cost 4 each
  assert.ok(Math.abs(loo.cost("crap_male", 1.5, -14, 0, 0.5)! - 23) < 1e-9); // (1 - 0.5) * 10 more
  assert.equal(loo.cost("buyfood", 0, 0, 0), null); // not offered
  const bin = new PropExplainer(parseExplainer("trashbin", BIN), { name: "trashbin", offset: { x: 0, y: 0 }, angle: 0 }, { x: 0, y: 0, yaw: 0 });
  assert.ok(bin.cost("disposeoflitter", 5, 0, 0) !== null);
  assert.equal(bin.cost("disposeoflitter", 50, 0, 0), null); // beyond range
  bin.takenUntil = 1;
  assert.equal(bin.cost("disposeoflitter", 5, 0, 0.5), null); // chosen a moment ago and cannot be queued for
  assert.ok(bin.cost("disposeoflitter", 5, 0, 1.5) !== null);
});

/** A body on a grid: a real walker, the way the world scene builds it. */
function body(nav: NavGrid, x: number, y: number): { actor: Actor; walker: PersonWalker } {
  const walker = new PersonWalker(x, y, 0, [1, 2, 4]);
  const actor: Actor = {
    get x() { return walker.x; }, get y() { return walker.y; },
    get walking() { return walker.moving; },
    walkTo(tx, ty) { const path = nav.findPath(walker, { x: tx, y: ty }); if (!path) return false; walker.go(path, 1); return true; },
    turnTo: (h, dt) => walker.turnTo(h, dt),
    stop: () => walker.stop(),
  };
  return { actor, walker };
}

function loo(x: number, y: number): PropExplainer {
  // a toilet whose goal is exactly (x, y)
  const def = parseExplainer("male_loo", LOO.replace("LocalPositionX=1.5", "LocalPositionX=0").replace("LocalPositionY=-4", "LocalPositionY=0").replace("LocalAngle=1.2", "LocalAngle=0"));
  return new PropExplainer(def, { name: "male_loo", offset: { x: 0, y: 0 }, angle: 0 }, { x, y, yaw: 0 });
}

test("a person with a strong desire walks to the cheapest prop, turns, uses it, and is satisfied", () => {
  const nav = new NavGrid();
  nav.openRect(-60, -60, 60, 60);
  const table = parseDesires(DESIRES);
  const near = loo(10, 0), far = loo(-40, 30);
  const { actor, walker } = body(nav, 0, 0);
  const agent = new DesireAgent(table, ["crap_male", "buyfood"], () => 0);
  agent.desires[0]!.level = 0.8;
  agent.desires[1]!.level = 0.2;
  let now = 0;
  const seen = new Set<string>();
  const dt = 0.05;
  for (let i = 0; i < 4000; i++) {
    now += dt;
    agent.update(dt, actor, [far, near], now);
    walker.step(dt); // the scene's step loop moves the walker after the agent has had its say
    if (agent.activity) seen.add(agent.activity.state);
    if (!agent.activity && now > TRY_START_SECONDS + 1 && seen.has("using")) break;
  }
  assert.deepEqual([...seen], ["enroute", "turning", "using"]);
  assert.equal(near.users, 0); // released
  assert.equal(near.occupied, false);
  assert.equal(far.users, 0);
  assert.ok(agent.desires[0]!.level < 0.5, "the satisfied desire dropped");
  assert.ok(Math.hypot(walker.x - 10, walker.y) < 1, "stood at the near toilet's goal");
  assert.ok(now > USE_SECONDS, "the use took its time");
});

test("a second person waits their turn at an occupied prop, and a cancelled activity frees the prop", () => {
  const nav = new NavGrid();
  nav.openRect(-60, -60, 60, 60);
  const table = parseDesires(DESIRES);
  const only = loo(10, 0);
  const a = body(nav, 0, 0), b = body(nav, 0, 4);
  const stepBoth = (dt: number) => { a.walker.step(dt); b.walker.step(dt); };
  const first = new DesireAgent(table, ["crap_male"], () => 0), second = new DesireAgent(table, ["crap_male"], () => 0);
  first.desires[0]!.level = 0.9;
  second.desires[0]!.level = 0.8;
  let now = 0;
  const dt = 0.05;
  for (let i = 0; i < 600 && !(first.activity?.state === "using" && second.activity); i++) {
    now += dt;
    first.update(dt, a.actor, [only], now);
    if (first.activity) second.update(dt, b.actor, [only], now); // the second starts after the first has chosen
    stepBoth(dt);
  }
  assert.equal(first.activity?.state, "using");
  assert.ok(only.occupied);
  for (let i = 0; i < 400; i++) { now += dt; second.update(dt, b.actor, [only], now); stepBoth(dt); }
  assert.equal(second.activity?.state, "waiting"); // arrived, the prop is in use
  first.cancel();
  assert.equal(only.occupied, false);
  for (let i = 0; i < 10; i++) { now += dt; second.update(dt, b.actor, [only], now); stepBoth(dt); }
  assert.equal(second.activity?.state, "using"); // their turn
  second.cancel();
  assert.equal(only.users, 0);
});

test("a desire below the idle threshold does not start, one above it does", () => {
  const nav = new NavGrid();
  nav.openRect(-60, -60, 60, 60);
  const table = parseDesires(DESIRES);
  const { actor } = body(nav, 0, 0);
  const agent = new DesireAgent(table, ["crap_male"], () => 0);
  agent.desires[0]!.level = IDLE_THRESHOLD - 0.1; // far enough below that it does not climb past during the wait
  agent.update(TRY_START_SECONDS + 0.1, actor, [loo(10, 0)], 0);
  assert.equal(agent.activity, null);
  agent.desires[0]!.level = IDLE_THRESHOLD + 0.01;
  agent.update(TRY_START_SECONDS + 0.1, actor, [loo(10, 0)], 0);
  assert.equal((agent.activity as Activity | null)?.state, "enroute"); // read again: the check above narrowed it to null
});

test("with no route to a prop the person tries the next one, and with none does nothing", () => {
  const nav = new NavGrid();
  nav.openRect(-60, -60, 60, 60);
  const table = parseDesires(DESIRES);
  const { actor } = body(nav, 0, 0);
  const agent = new DesireAgent(table, ["crap_male"], () => 0);
  agent.desires[0]!.level = 0.8;
  const off = loo(500, 500); // outside the walkable grid: no route
  agent.update(TRY_START_SECONDS + 0.1, actor, [off], 0);
  assert.equal(agent.activity, null);
  assert.equal(off.users, 0);
});

test("a desire ticks ten times a second", () => {
  const table = parseDesires(DESIRES);
  const nav = new NavGrid();
  const { actor } = body(nav, 0, 0);
  const agent = new DesireAgent(table, ["crap_male"], () => 0);
  const before = agent.desires[0]!.level;
  agent.update(DESIRE_UPDATE_SECONDS * 3 + 0.01, actor, [], 0);
  const expected = (() => { let v = before; for (let i = 0; i < 3; i++) v = v + (1 - v) * 0.002; return v; })();
  assert.ok(Math.abs(agent.desires[0]!.level - expected) < 1e-12);
});

test("the real files parse as decoded", { skip: haveGame ? false : "needs the game archives (OTM_GAME_DIR)" }, async () => {
  const pak = await pakIndex();
  const csv = await pak.readByName("desires.csv", { dir: "data\\rule\\" });
  assert.ok(csv, "data\\rule\\desires.csv");
  const t = parseDesires(new TextDecoder("latin1").decode(csv));
  for (const name of ["crap_male", "crap_female", "buyfood", "gawp", "propinteract"]) {
    const d = t.get(name);
    assert.ok(d && d.maxDesire !== undefined && d.increment !== undefined && d.increment > 0, name);
  }
  const portaloo = await pak.readByName("female_portaloo.ini", { dir: "data\\explainers\\" });
  assert.ok(portaloo);
  const def = parseExplainer("female_portaloo", new TextDecoder("latin1").decode(portaloo));
  assert.ok(def.actions.has("crap_female"));
  const counter = await pak.readByName("counter.ini", { dir: "data\\explainers\\" });
  assert.ok(counter && parseExplainer("counter", new TextDecoder("latin1").decode(counter)).actions.has("buyfood"));
});

test("a real world: toilets and counters are placed with reachable goals, and loose people use them", { skip: haveGame && QUICK ? false : "needs the game archives and a Quick Start save" }, async () => {
  const world = await loadWorldData(await pakIndex(), parseSave(new Uint8Array(readFileSync(QUICK!))));
  const offered = new Map<string, number>();
  for (const p of world.props) for (const a of p.def.actions.keys()) offered.set(a, (offered.get(a) ?? 0) + 1);
  assert.ok((offered.get("crap_male") ?? 0) > 0 && (offered.get("crap_female") ?? 0) > 0, `toilets: ${[...offered]}`);
  assert.ok((offered.get("buyfood") ?? 0) > 0, `counters: ${[...offered]}`);
  assert.ok(world.desires.has("crap_male") && world.desires.has("buyfood"));

  // every outdoor person gets an agent, the way the scene builds them; run 30 game minutes with strong desires so the loop is exercised
  const uses = new Map<string, number>();
  const agents = world.people.filter((p) => p.outdoors).map((entry) => {
    const walker = new PersonWalker(entry.person.position[0], entry.person.position[1], entry.person.angle, entry.gaits.speeds);
    const female = (entry.person.costume?.cos ?? "").toLowerCase().startsWith("f_");
    const actor: Actor = {
      get x() { return walker.x; }, get y() { return walker.y; }, get walking() { return walker.moving; },
      walkTo(x, y) { const path = world.nav.findPath(walker, { x, y }); if (!path) return false; walker.go(path, 0); return true; },
      turnTo: (h, dt) => walker.turnTo(h, dt), stop: () => walker.stop(),
    };
    const agent = new DesireAgent(world.desires, [female ? "crap_female" : "crap_male", "buyfood"]);
    for (const d of agent.desires) d.level = 0.8;
    return { agent, actor, walker };
  });
  assert.ok(agents.length > 0, "someone is outdoors");
  let now = 0;
  const dt = 0.1;
  for (let i = 0; i < 30 * 60 / dt; i++) {
    now += dt;
    for (const a of agents) {
      const before = a.agent.activity;
      a.agent.update(dt, a.actor, world.props, now);
      if (before?.state === "using" && !a.agent.activity) uses.set(before.desire.action, (uses.get(before.desire.action) ?? 0) + 1);
      a.walker.step(dt);
    }
  }
  assert.ok([...uses.values()].reduce((x, y) => x + y, 0) > 0, `nobody finished a use of ${world.props.length} props among ${agents.length} people`);
});
