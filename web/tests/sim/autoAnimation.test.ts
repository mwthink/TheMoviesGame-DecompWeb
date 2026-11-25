// Auto-animated models (the flags): .anm parsing, skinning and the playback rules. Needs the game archives for the real-file checks.
import assert from "node:assert/strict";
import { test } from "node:test";
import { anmDurationMs, anmFramePosition } from "../../src/formats/Anm.ts";
import { parseMsh, type Msh } from "../../src/formats/Msh.ts";
import { AutoAnimator, catmullRom, clipFits, poseSmoothing } from "../../src/sim/anim/AutoAnimation.ts";
import { loadAutoAnimClips } from "../../src/world/WorldData.ts";
import { haveGame, pakIndex } from "../helpers.ts";

const game = { skip: haveGame ? false : "game archives not found (set OTM_PAK_DIR)" };

test("clip length and frame position follow FUN_0059ee40 and FUN_00985eb0", () => {
  const a = { nFrames: 55, flags: 3 };
  assert.equal(anmDurationMs(a), 1800); // (54 / 3 + 1) * 100 - 100
  assert.equal(anmFramePosition(a, 0), 0);
  assert.equal(anmFramePosition(a, 900), 27);
  assert.equal(anmFramePosition(a, 1800), 0); // loops
  assert.equal(anmDurationMs({ nFrames: 55, flags: 1 }), 5400);
});

test("the flag prop: 7-bone skeleton, a 55-frame clip that fits, skinned cloth that waves", game, async () => {
  const pak = await pakIndex();
  const msh = parseMsh((await pak.readByName("p_flag.msh"))!);
  assert.equal(msh.skeleton.length, 7);
  assert.deepEqual(msh.skeleton.map((b) => b.parent), [-1, 0, 1, 1, 3, 3, 5]);
  const skinned = msh.primitives.filter((p) => p.skin);
  assert.equal(skinned.length, 1);
  assert.equal(skinned[0]!.positions.length / 3, 49);

  const clips = await loadAutoAnimClips(pak, "p_flag.msh", msh);
  assert.equal(clips.length, 1);
  assert.equal(clips[0]!.nFrames, 55);
  assert.ok(clipFits(msh.skeleton, clips[0]!));

  const animator = new AutoAnimator(msh, clips, () => 0);
  const bind = skinned[0]!.positions;
  const frame0 = Float32Array.from(animator.skinned[0]!.positions);
  // at frame 0 the rebased pose is the model as built
  for (let i = 0; i < bind.length; i++) assert.ok(Math.abs(frame0[i]! - bind[i]!) < 1e-3, `vertex component ${i}`);
  animator.step(450); // a quarter of the loop: the cloth has moved sideways
  let moved = 0;
  for (let i = 0; i < bind.length; i++) moved = Math.max(moved, Math.abs(animator.skinned[0]!.positions[i]! - bind[i]!));
  assert.ok(moved > 0.1 && moved < 2, `largest displacement ${moved}`);
  for (const v of animator.skinned[0]!.positions) assert.ok(Number.isFinite(v));
});

test("playback: real frame time, capped at 99 ms, a clip is re-chosen when it wraps", () => {
  const msh = { primitives: [], skeleton: [] } as unknown as Msh;
  const clip = { nFrames: 55, nChannels: 0, flags: 3, parents: new Int16Array(0), angles: new Float32Array(0), translations: new Float32Array(0), stride: 0 };
  let picks = 0;
  const animator = new AutoAnimator(msh, [clip, clip], () => (picks++ % 2 ? 0.9 : 0.1));
  assert.equal(animator.clip, 0);
  let wraps = 0;
  for (let ms = 0; ms < 1800; ms += 99) if (animator.step(500)) wraps++; // a 500 ms stall counts as 99 ms
  assert.equal(wraps, 1);
  assert.equal(animator.clip, 1); // the second random pick
});

test("the lot gate's flag clip fits its skeleton and poses to finite vertices", game, async () => {
  const pak = await pakIndex();
  for (const name of ["lot_gate.msh"]) {
    const msh = parseMsh((await pak.readByName(name))!);
    const clips = await loadAutoAnimClips(pak, name, msh);
    assert.ok(clips.length >= 1, `${name} has no fitting clip`);
    const animator = new AutoAnimator(msh, clips, () => 0);
    animator.step(600);
    for (const s of animator.skinned) for (const v of s.positions) assert.ok(Number.isFinite(v));
  }
});

test("smoothing: Catmull-Rom hits the stored frames, is smooth through them, and is off by default", () => {
  assert.equal(poseSmoothing(), false);
  assert.equal(catmullRom(0, 1, 2, 3, 0), 1);
  assert.equal(catmullRom(0, 1, 2, 3, 1), 2);
  assert.ok(Math.abs(catmullRom(0, 1, 2, 3, 0.5) - 1.5) < 1e-12); // a straight run stays straight
  // a ramp that stops: the straight blend turns at the knot, the cubic eases (slope into frame 2 is gentler than the segment's mean)
  const slopeIn = catmullRom(0, 1, 2, 2, 1) - catmullRom(0, 1, 2, 2, 0.99);
  assert.ok(slopeIn < 0.01 * 1);
});
