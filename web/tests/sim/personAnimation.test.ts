// Person animation: scene files, playlists, the player (docs/PEOPLE.md "Animation").
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { firstAnimation, parseFlm } from "../../src/formats/Flm.ts";
import { parseSeq } from "../../src/formats/Seq.ts";
import { parseSave } from "../../src/formats/Jad.ts";
import type { Anm } from "../../src/formats/Anm.ts";
import type { MshBone } from "../../src/formats/Msh.ts";
import { BLEND_MS, PersonAnimator } from "../../src/sim/anim/PersonAnimation.ts";
import { loadWorldData } from "../../src/world/WorldData.ts";
import { findSave, haveGame, pakIndex } from "../helpers.ts";

const QUICK = findSave("QUICKSTART");
const game = { skip: haveGame ? false : "game archives not found (set OTM_PAK_DIR)" };
const needs = { skip: QUICK && haveGame ? false : "needs the game archives and a Quick Start save" };

test("a .seq is a weighted playlist with a base idle", game, async () => {
  const pak = await pakIndex();
  const seq = parseSeq((await pak.readByName("staff_idle.seq"))!);
  assert.equal(seq.clips.length, 7);
  assert.equal(seq.baseIdle, "idle_male.anm");
  assert.equal(seq.weights.length, 7);
  assert.ok(Math.abs(seq.weights[4]! - 0.569) < 0.01);
  const hired = parseSeq((await pak.readByName("ai_hired.seq"))!);
  assert.equal(hired.clips.length, 4);
  assert.equal(hired.baseIdle, null);
});

test("the pre-production crew scene starts with the staff idle playlist", game, async () => {
  const pak = await pakIndex();
  const flm = parseFlm((await pak.readByName("ai_room_preprod_crew_00.flm", { dir: "data\\scene\\interactions\\" }))!);
  const first = firstAnimation(flm)!;
  assert.equal(first.name, "staff_idle.seq");
  assert.ok(Math.abs(first.startAngle - -1.530371) < 1e-4); // the facing the scene gives its first character
});

test("people in rooms with scenes get their scene's clip, the rest the fallback idle (and say so)", needs, async () => {
  const world = await loadWorldData(await pakIndex(), parseSave(new Uint8Array(readFileSync(QUICK!))));
  const fromScene = world.people.filter((p) => p.plan && !p.plan.source.startsWith("fallback"));
  const fallback = world.people.filter((p) => p.plan?.source.startsWith("fallback"));
  assert.ok(fromScene.length >= 5, `${fromScene.length} from scenes`);
  assert.ok(fromScene.every((p) => /^ai_room_.*\.flm: /.test(p.plan!.source)));
  assert.ok(fallback.every((p) => /\(.*\)/.test(p.plan!.source)));
  assert.ok(world.people.every((p) => p.plan !== null && p.clips.size > 0));
  assert.ok(fromScene.some((p) => p.plan!.seq !== null));
});

test("the animator loops, picks fidgets from the playlist and returns skinning transforms", needs, async () => {
  const world = await loadWorldData(await pakIndex(), parseSave(new Uint8Array(readFileSync(QUICK!))));
  const crew = world.people.find((p) => p.plan?.seq)!;
  let r = 0.3;
  const animator = new PersonAnimator(crew.skeleton, crew.clips, crew.plan!, () => (r = (r * 7.31 + 0.11) % 1));
  const seen = new Set<string>();
  let last = null;
  for (let t = 0; t < 120_000; t += 33) {
    last = animator.step(33);
    seen.add(animator.clipName);
  }
  assert.ok(last && last.length === crew.skeleton.length);
  assert.ok(seen.has("idle_male.anm"));
  assert.ok(seen.size > 1, "a fidget played within two minutes");
  for (const t of last!) for (const x of [...t.rot, ...t.move]) assert.ok(Number.isFinite(x));
});

// A change of clip cross-fades instead of snapping. Synthetic clips on a two-bone skeleton: no game files needed.
function syntheticClip(angle: number, lift: number): Anm {
  // 2 frames (100 ms), 2 channels: the root holds `lift` in z, the child is turned by `angle` about x
  return { nFrames: 2, nChannels: 2, parents: Int16Array.from([-1, 0]), flags: 0, stride: 0,
    angles: Float32Array.from([0, 0, 0, angle, 0, 0, 0, 0, 0, angle, 0, 0]),
    translations: Float32Array.from([0, 0, lift, 0, 0, 1, 0, 0, lift, 0, 0, 1]) };
}
const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;
const SKELETON: MshBone[] = [
  { name: "root", parent: -1, rot: [...ID], pos: [0, 0, 0] },
  { name: "child", parent: 0, rot: [...ID], pos: [0, 0, 1] },
];

test("a change of clip fades from the old pose to the new one over BLEND_MS", () => {
  const clips = new Map<string, Anm>([["idle", syntheticClip(0, 0)], ["walk", syntheticClip(1, 0.5)]]);
  const animator = new PersonAnimator(SKELETON, clips, { source: "test", clip: "idle", seq: null }, () => 0);
  const lift = (t: ReturnType<PersonAnimator["step"]>) => t![0]!.move[2]!; // the root bone's height, which the clip sets
  const before = lift(animator.step(16));
  animator.setOverride("walk");
  const first = lift(animator.step(1)); // just after the change: still the old pose
  assert.ok(Math.abs(first - before) < 0.02, `snapped: ${before} -> ${first}`);
  const mid = lift(animator.step(BLEND_MS / 2));
  assert.ok(mid > before + 0.1 && mid < 0.5 - 0.05, `halfway, ${mid}`);
  const done = lift(animator.step(BLEND_MS));
  assert.ok(Math.abs(done - 0.5) < 1e-6, `finished: ${done}`);
  // and back
  animator.setOverride(null);
  const back = lift(animator.step(1));
  assert.ok(Math.abs(back - 0.5) < 0.02, `snapped back: ${back}`);
  assert.ok(Math.abs(lift(animator.step(BLEND_MS * 2)) - 0) < 1e-6);
});
