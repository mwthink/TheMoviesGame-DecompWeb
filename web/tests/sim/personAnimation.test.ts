// Person animation: scene files, playlists, the player (docs/PEOPLE.md "Animation").
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { firstAnimation, parseFlm } from "../../src/formats/Flm.ts";
import { parseSeq } from "../../src/formats/Seq.ts";
import { parseSave } from "../../src/formats/Jad.ts";
import { PersonAnimator } from "../../src/sim/anim/PersonAnimation.ts";
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
