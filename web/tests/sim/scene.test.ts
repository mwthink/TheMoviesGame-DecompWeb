// The interaction scene player (docs/FLM_FORMAT.md 4 to 5d, docs/DESIRES.md "Scenes").
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFlm } from "../../src/formats/Flm.ts";
import { anmDurationMs, anmSpeed, parseAnm, type Anm } from "../../src/formats/Anm.ts";
import { buildSceneGraph, type SceneBox, type SceneGraph } from "../../src/formats/FlmScene.ts";
import { DesireAgent, type Actor, type SceneContext } from "../../src/sim/ai/DesireAgent.ts";
import { parseDesires } from "../../src/sim/ai/Desires.ts";
import { PropExplainer, parseExplainer } from "../../src/sim/ai/Explainers.ts";
import { SceneRunner, type SceneOptions } from "../../src/sim/scene/SceneRunner.ts";
import { PersonWalker } from "../../src/sim/anim/Walker.ts";
import { NavGrid } from "../../src/sim/nav/NavGrid.ts";
import { haveGame, pakIndex } from "../helpers.ts";

// ---- helpers to build a graph by hand ----
function box(id: number, kind: SceneBox["kind"], next: number, extra: Partial<SceneBox> = {}): SceneBox {
  return { id, kind, x: 0, y: 0, z: 0, yaw: 0, links: [{ next, slot: 0 }], steps: 0, clip: null, path: null, selector: 0, branches: [], weights: [], channelSet: null, ...extra };
}
function graph(boxes: SceneBox[], channels: string[] = ["ai_stop", "ai_ai_seat"], start = 1): SceneGraph {
  return {
    strings: channels, channelCount: channels.length, channelNames: channels, channelInitial: channels.map(() => 0),
    boxes: new Map(boxes.map((b) => [b.id, b])), actors: [{ startBox: start, x: 0, y: 0, z: 0, yaw: 0 }],
  };
}
const CLIP_MS: Record<string, number> = { "sit.anm": 2000, "stand.anm": 1000, "walk.anm": 600 };
function opts(over: Partial<SceneOptions> = {}): SceneOptions {
  return { female: false, random: () => 0.5, clipMs: (c) => CLIP_MS[c], walkSpeed: () => 1.5, sliderSets: new Set(["ai_ai_seat"]), ...over };
}

/** sit 2 s -> set ai_ai_seat to 1 -> choose on ai_stop: loop (0) or stand up (1) -> stand 1 s -> end */
function sitScene(): SceneGraph {
  return graph([
    box(1, "anim", 2, { clip: "sit.anm", x: 1, y: 2, yaw: 0.5 }),
    box(2, "settings", 3, { channelSet: { channel: 1, mode: 0, value: 1 } }),
    box(3, "choice", -1, { selector: 0, branches: [[{ next: 1, slot: 0 }], [{ next: 4, slot: 0 }]], weights: [0, 0] }),
    box(4, "anim", -1, { clip: "stand.anm", x: 3, y: 4, yaw: 0 }),
  ]);
}

test("a looping scene plays its clip, fires its slider each cycle, and leaves through the exit when ai_stop is set", () => {
  const r = new SceneRunner(sitScene(), opts());
  assert.equal(r.clip, "sit.anm");
  assert.deepEqual(r.place, { x: 1, y: 2, yaw: 0.5 });
  let events = 0, t = 0;
  while (t < 5) { r.step(0.05); t += 0.05; events += r.takeEvents().length; }
  assert.equal(events, 2, "once per 2 s cycle"); // at 2 s and 4 s
  assert.equal(r.finished, false);
  r.setChannel("ai_stop", 1);
  const clips = new Set<string | null>();
  while (!r.finished && t < 20) { r.step(0.05); t += 0.05; clips.add(r.clip); events += r.takeEvents().length; }
  assert.ok(r.finished && clips.has("stand.anm"), "stood up and ended");
  assert.ok(t < 8.2, `ended within the cycle plus the stand clip: ${t}`);
  assert.equal(r.clip, null);
});

test("a channel set fires a slider set only when it is named like one, once, and clears", () => {
  const r = new SceneRunner(sitScene(), opts({ sliderSets: new Set() })); // no slider set of that name: no event
  for (let i = 0; i < 100; i++) r.step(0.05);
  assert.equal(r.takeEvents().length, 0);
  assert.equal(r.channel("ai_ai_seat"), 1, "the channel stays set when nothing fires it");
  const s = new SceneRunner(sitScene(), opts());
  for (let i = 0; i < 45; i++) s.step(0.05); // 2.25 s: the first cycle's set has happened
  assert.deepEqual(s.takeEvents(), ["ai_ai_seat"]);
  assert.equal(s.channel("ai_ai_seat"), 0, "cleared after firing");
});

test("a choice on a channel takes round(n x the value), halves to the even, kept under n", () => {
  // run it through the runner and read which box it landed on, by the anim box's position
  const landed = (value: number, n: number): number => {
    const branches = Array.from({ length: n }, (_, i) => [{ next: 10 + i, slot: 0 }]);
    const boxes = [box(1, "choice", -1, { selector: 0, branches, weights: [] }), ...branches.map((_, i) => box(10 + i, "anim", -1, { clip: "stand.anm", x: i }))];
    const r = new SceneRunner(graph(boxes), opts());
    r.setChannel("ai_stop", value);
    r.step(0.001);
    return r.place.x;
  };
  assert.deepEqual([0, 0.2, 0.5, 0.8, 1].map((v) => landed(v, 2)), [0, 0, 1, 1, 1]); // 2 x 0.2 = 0.4 -> 0; 2 x 0.5 = 1; 2 x 1 = 2 -> kept at 1
  assert.deepEqual([0, 0.1, 0.2, 0.5, 0.9, 1].map((v) => landed(v, 3)), [0, 0, 1, 2, 2, 2]); // 0.3 -> 0; 0.6 -> 1; 1.5 -> 2 (even); 2.7 -> 3 -> 2
  assert.equal(landed(5, 2), 1, "channels are clamped to 1");
  assert.equal(landed(-3, 2), 0, "and to 0");
});

test("random choices scan the weights in order and fall back to a random branch; the female choice reads the costume", () => {
  const rnd = (r: number, weights: number[]): number => {
    const branches = weights.map((_, i) => [{ next: 10 + i, slot: 0 }]);
    const boxes = [box(1, "choice", -1, { selector: -1, branches, weights }), ...branches.map((_, i) => box(10 + i, "anim", -1, { clip: "stand.anm", x: i }))];
    const run = new SceneRunner(graph(boxes), opts({ random: () => r }));
    run.step(0.001);
    return run.place.x;
  };
  assert.equal(rnd(0.3, [0.5, 0.8, 1]), 0); // first weight not under the number
  assert.equal(rnd(0.6, [0.5, 0.8, 1]), 1);
  assert.equal(rnd(0.9, [0.5, 0.8, 1]), 2);
  assert.equal(rnd(0.99, [0.5, 0.2, 0.25]), 2, "no weight reached: a random branch, here floor(0.99 x 3)");
  const fem = (female: boolean): number => {
    const boxes = [box(1, "choice", -1, { selector: -3, branches: [[{ next: 10, slot: 0 }], [{ next: 11, slot: 0 }]], weights: [0, 0] }), box(10, "anim", -1, { clip: "stand.anm", x: 0 }), box(11, "anim", -1, { clip: "stand.anm", x: 1 })];
    const run = new SceneRunner(graph(boxes), opts({ female }));
    run.step(0.001);
    return run.place.x;
  };
  assert.deepEqual([fem(false), fem(true)], [0, 1]);
});

test("a move box walks its path at the walk clip's speed and faces the way it goes", () => {
  const boxes = [
    box(1, "move", 2, { clip: "walk.anm", path: { p: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]], length: 3, straight: true } }),
    box(2, "anim", -1, { clip: "stand.anm", x: 3 }),
  ];
  const r = new SceneRunner(graph(boxes), opts({ walkSpeed: () => 1.5 })); // 3 units at 1.5 per second: 2 s
  r.step(1);
  assert.ok(Math.abs(r.place.x - 1.5) < 1e-9 && Math.abs(r.place.yaw) < 1e-9);
  assert.equal(r.clip, "walk.anm");
  r.step(1.2);
  assert.equal(r.clip, "stand.anm");
  const curve = [box(1, "move", -1, { clip: "walk.anm", path: { p: [[0, 0, 0], [0, 1, 0], [1, 2, 0], [2, 2, 0]], length: 3.2, straight: false } })];
  const c = new SceneRunner(graph(curve), opts({ walkSpeed: () => 1 }));
  c.step(0.01);
  assert.ok(c.place.yaw > 1.4 && c.place.yaw < 1.7, `leaves along +y: ${c.place.yaw}`);
  c.step(3.1);
  assert.ok(Math.abs(c.place.yaw) < 0.2, `and ends heading along +x: ${c.place.yaw}`);
});

test("boxes that finish at once are followed, a wait box waits in steps of 1/30 s, and a loop with no wait cannot hang", () => {
  const w = new SceneRunner(graph([box(1, "box", 2, { steps: 30 }), box(2, "anim", -1, { clip: "stand.anm" })]), opts());
  w.step(0.9);
  assert.equal(w.clip, null, "still waiting after 0.9 s of a 1 s wait");
  w.step(0.2);
  assert.equal(w.clip, "stand.anm");
  const loop = new SceneRunner(graph([box(1, "pass", 2), box(2, "pass", 1)]), opts());
  loop.step(1); // returns: the guard stops the loop
  assert.equal(loop.finished, false);
  const unknown = new SceneRunner(graph([box(1, "anim", -1, { clip: "missing.anm" })]), opts());
  unknown.step(0.5);
  assert.equal(unknown.finished, false, "an unloaded clip is held for a second");
  unknown.step(0.6);
  assert.equal(unknown.finished, true);
});

test("channel set modes: set, add and random up to the value, all kept within 0..1", () => {
  const setMode = (mode: number, value: number, _unused = 0, rnd = 0.5): number => {
    const r = new SceneRunner(graph([box(1, "settings", -1, { channelSet: { channel: 1, mode, value } })]), opts({ random: () => rnd, sliderSets: new Set() }));
    return r.channel("ai_ai_seat");
  };
  assert.equal(setMode(0, 0.7), 0.7);
  assert.equal(setMode(1, 0.4), 0.4); // from 0
  assert.equal(setMode(1, 4), 1, "clamped");
  assert.equal(setMode(2, 0, 0, 0.25), 0.25, "random from 0 to 1 when the value is 0");
  assert.equal(setMode(2, 0.5, 0, 0.5), 0.25);
});

// ---- the scene library of the game ----
test("every AI interaction scene in the archives decodes: all links point at boxes, choice records have the predicted size", { skip: haveGame ? false : "needs the game archives (OTM_GAME_DIR)" }, async () => {
  const pak = await pakIndex();
  const files = pak.list("data\\scene\\interactions\\").filter((f) => /^ai_.*\.flm$/i.test(f.entry.name));
  assert.ok(files.length > 400, `ai scenes: ${files.length}`);
  let boxes = 0;
  for (const f of files) {
    const flm = parseFlm(await pak.read(f));
    const g = buildSceneGraph(flm);
    for (const a of g.actors) assert.ok(a.startBox === -1 || g.boxes.has(a.startBox), `${f.entry.name}: start box`);
    for (const b of g.boxes.values()) {
      boxes++;
      for (const l of [...b.links, ...b.branches.flat()]) assert.ok(l.next === -1 || g.boxes.has(l.next), `${f.entry.name}: box ${b.id} links to ${l.next}`);
    }
    for (const o of flm.objects) if (o.type === 3) {
      const b0 = o.words[8]! & 0xff, n = o.words[16]! & 0xff;
      assert.equal(o.words.length, 19 + 3 * b0 + n * (3 * b0 + 1) + (o.words[9]! & 0xff) + (o.words[10]! & 0xff), `${f.entry.name}: choice ${o.words[2]} size`);
    }
  }
  assert.ok(boxes > 20000);
});

async function realScene(name: string, sets: string[], female: boolean, stopAt: number): Promise<{ finished: boolean; t: number; events: number; clips: string[] }> {
  const pak = await pakIndex();
  const g = buildSceneGraph(parseFlm((await pak.readByName(name, { dir: "data\\scene\\interactions\\" }))!));
  const anms = new Map<string, Anm>();
  for (const b of g.boxes.values()) if (b.clip && !anms.has(b.clip)) { const bytes = await pak.readByName(b.clip); if (bytes) anms.set(b.clip, parseAnm(bytes)); }
  let n = 1;
  const rng = () => { n = (n * 1103515245 + 12345) & 0x7fffffff; return n / 0x7fffffff; };
  const r = new SceneRunner(g, { female, random: rng, sliderSets: new Set(sets), clipMs: (c) => { const a = anms.get(c); return a ? anmDurationMs(a) : undefined; }, walkSpeed: (c) => { const a = c ? anms.get(c) : undefined; return a ? anmSpeed(a) || undefined : undefined; }, channels: { ai_male: female ? 0 : 1, ai_star: 0, ai_drunk: 0 } });
  let t = 0, events = 0;
  const clips: string[] = [];
  while (!r.finished && t < 400) {
    t += 0.05;
    if (t >= stopAt) r.setChannel("ai_stop", 1);
    r.step(0.05);
    events += r.takeEvents().length;
    if (r.clip && clips[clips.length - 1] !== r.clip) clips.push(r.clip);
  }
  return { finished: r.finished, t, events, clips };
}

test("the bench scene sits, loops while nobody stops it firing ai_ai_seat, and stands up when told", { skip: haveGame ? false : "needs the game archives (OTM_GAME_DIR)" }, async () => {
  const forever = await realScene("ai_sit_bench_0.flm", ["ai_ai_seat"], false, Infinity);
  assert.equal(forever.finished, false);
  assert.ok(forever.events > 50, `fired often: ${forever.events}`); // about every 3 s
  assert.equal(forever.clips[0], "sit_down_standard.anm");
  const stopped = await realScene("ai_sit_bench_0.flm", ["ai_ai_seat"], false, 40);
  assert.ok(stopped.finished && stopped.t < 50, `ended soon after the stop: ${stopped.t}`);
  assert.ok(stopped.clips.some((c) => /sit2std|sit_to_stand|sit2stand/.test(c)), `stood up: ${stopped.clips}`);
});

test("the portaloo scene walks in, uses it and walks out on its own", { skip: haveGame ? false : "needs the game archives (OTM_GAME_DIR)" }, async () => {
  const r = await realScene("ai_loo_male1930.flm", [], false, Infinity);
  assert.ok(r.finished && r.t > 5 && r.t < 30, `${r.t}`);
  assert.deepEqual(r.clips.slice(0, 4), ["walk.anm", "portaloo_enter.anm", "portaloo_idle.anm", "portaloo_exit.anm"]);
});

test("the burger counter scene fires its slider set once", { skip: haveGame ? false : "needs the game archives (OTM_GAME_DIR)" }, async () => {
  const r = await realScene("ai_burger_1930_0.flm", ["ai_ai_counter"], false, Infinity);
  assert.ok(r.finished && r.events === 1, `${r.finished} ${r.events}`);
});

// ---- the agent playing a scene ----
const SEAT = `interaction = test_sit.flm
queueable = 0
range = 100
[action]
	[action/propinteract]
		[action/propinteract/cost]
[aisliders]
	[aisliders/ai_ai_seat]
		desire_propinteract = -0.2
[pos]
LocalPositionX=0
LocalPositionY=0
LocalPositionZ=0
LocalAngle=0
`;
const TABLE = parseDesires("name,fixeddesire,maxdesire,increment,fixedurgency\npropinteract,,0.8,0.0001,0.5\nbuyfood,,0.8,0.0001,0.5\n");

function sceneBody(nav: NavGrid, x: number, y: number) {
  const walker = new PersonWalker(x, y, 0, [1, 2, 4]);
  const log: { clip: string | null; at: { x: number; y: number; heading: number } | null }[] = [];
  const actor: Actor = {
    get x() { return walker.x; }, get y() { return walker.y; }, get heading() { return walker.heading; },
    get walking() { return walker.moving; },
    walkTo(tx, ty) { const path = nav.findPath(walker, { x: tx, y: ty }); if (!path) return false; walker.go(path, 1); return true; },
    turnTo: (h, dt) => walker.turnTo(h, dt), stop: () => walker.stop(),
    playClip: (name) => { log.push({ clip: name, at: null }); },
    placeAt: (px, py, heading) => { walker.place(px, py, heading); log.push({ clip: null, at: { x: px, y: py, heading } }); },
  };
  return { actor, walker, log };
}

test("an agent that uses a prop plays its scene, applies the slider each time the scene fires it, stops when another desire is stronger, and does not also reset the desire", () => {
  const nav = new NavGrid();
  nav.openRect(-60, -60, 60, 60);
  const def = parseExplainer("seat", SEAT);
  const prop = new PropExplainer(def, { name: "seat", offset: { x: 0, y: 0 }, angle: 0 }, { x: 10, y: 0, yaw: 0 });
  const ctx: SceneContext = { graphs: new Map([["test_sit.flm", sitScene()]]), female: false, star: false, clipMs: (c) => CLIP_MS[c], walkSpeed: () => 1.5 };
  const { actor, walker, log } = sceneBody(nav, 0, 0);
  const agent = new DesireAgent(TABLE, ["propinteract", "buyfood"], () => 0.5, ctx);
  agent.desires[0]!.level = 0.7; // propinteract
  agent.desires[1]!.level = 0.4; // buyfood: below the idle threshold and no prop for it, so it does not start; it rises above the other during the use
  let now = 0, usedFor = 0;
  const dt = 0.05;
  for (let i = 0; i < 4000 && !(agent.activity === null && usedFor > 0); i++) {
    now += dt;
    agent.update(dt, actor, [prop], now);
    walker.step(dt);
    if (agent.activity?.state === "using") { usedFor += dt; agent.desires[1]!.level = 0.95; } // a stronger desire appears while sitting
  }
  assert.equal(agent.activity, null);
  assert.equal(prop.occupied, false);
  assert.ok(usedFor > 1 && usedFor < 8, `stopped within a cycle or two of the stronger desire: ${usedFor}`);
  const level = agent.desires[0]!.level;
  assert.ok(level > 0.35 && level < 0.6, `the slider's -0.2 came off once or twice and the desire was not reset: ${level}`);
  assert.ok(log.some((l) => l.clip === "sit.anm") && log.some((l) => l.clip === "stand.anm"), "played the scene's clips");
  assert.equal(log[log.length - 1]!.clip, null, "and handed the clip back");
});

test("the scene is anchored where the person stands, turned by the difference of the headings", () => {
  const nav = new NavGrid();
  nav.openRect(-60, -60, 60, 60);
  const def = parseExplainer("seat", SEAT);
  // the prop's goal faces +y (a quarter turn): the person arrives at (10, 0) facing it, and the scene's frame (start at 0,0 facing 0) is turned by that
  const prop = new PropExplainer(def, { name: "seat", offset: { x: 0, y: 0 }, angle: Math.PI / 2 }, { x: 10, y: 0, yaw: 0 });
  const ctx: SceneContext = { graphs: new Map([["test_sit.flm", sitScene()]]), female: false, star: false, clipMs: (c) => CLIP_MS[c], walkSpeed: () => 1.5 };
  const { actor, walker, log } = sceneBody(nav, 0, 0);
  const agent = new DesireAgent(TABLE, ["propinteract"], () => 0.5, ctx);
  agent.desires[0]!.level = 0.9;
  let now = 0;
  for (let i = 0; i < 1500 && !log.some((l) => l.at); i++) { now += 0.05; agent.update(0.05, actor, [prop], now); walker.step(0.05); }
  const first = log.find((l) => l.at)!.at!;
  // the first box is at (1, 2) facing 0.5 in the scene; the start is (0, 0) facing 0; turned a quarter: (1, 2) -> (-2, 1), heading 0.5 + pi/2, from the standing place (10, 0)
  assert.ok(Math.abs(first.x - 8) < 0.2 && Math.abs(first.y - 1) < 0.2, `${first.x} ${first.y}`);
  assert.ok(Math.abs(first.heading - (0.5 + Math.PI / 2)) < 0.05, `${first.heading}`);
});

test("a prop whose scene is not available is used for the fixed time and its slider is applied at the end", () => {
  const nav = new NavGrid();
  nav.openRect(-60, -60, 60, 60);
  const prop = new PropExplainer(parseExplainer("seat", SEAT), { name: "seat", offset: { x: 0, y: 0 }, angle: 0 }, { x: 10, y: 0, yaw: 0 });
  const ctx: SceneContext = { graphs: new Map(), female: false, star: false, clipMs: () => undefined, walkSpeed: () => undefined };
  const { actor, walker, log } = sceneBody(nav, 0, 0);
  const agent = new DesireAgent(TABLE, ["propinteract"], () => 0.5, ctx);
  agent.desires[0]!.level = 0.7;
  let now = 0, used = false;
  for (let i = 0; i < 2000 && !(used && agent.activity === null); i++) { now += 0.05; agent.update(0.05, actor, [prop], now); walker.step(0.05); if (agent.activity?.state === "using") used = true; }
  assert.equal(agent.activity, null);
  assert.equal(log.length, 0, "no scene clips");
  assert.ok(agent.desires[0]!.level < 0.7, "the slider came off at the end");
});
