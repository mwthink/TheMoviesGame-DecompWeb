// The character (StarMaker) code: the star file, the makeup / hair / iris rules, .fan and .hd always run on inline values (two info.sm files from the
// real editor). The sliders and expressions read the game's files from the archives, and the slider check also needs stars saved in the editor
// (OTM_STAR_DIR, default ~/Documents/The Movies/StarMaker): an all-default male star and one with nine advanced sliders moved; each part skips without them.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { inflate } from "../../src/assets/inflate.ts";
import { GAME_DIR, STAR_DIR } from "../../localPaths.ts";
import { parseAnm } from "../../src/sim/character/AnmFile.ts";
import {
  buildFaceLayerPlan, expressionAnimationFile, EXPRESSION_FRAME_COUNT, greyOverlayAlpha, hairColourSuffix, hairTextureFile, irisUvOffset, MakeupCategory,
  makeupCategoryForParamType, makeupLayerFileName, makeupOptionCount, parseFan,
} from "../../src/sim/character/Appearance.ts";
import { applyExpression, applyFaceSliders, expressionEnvelope, FaceRig, parseSliderIni, sliderFrame, SLIDER_NEUTRAL } from "../../src/sim/character/FaceRig.ts";
import { applyHdMorph, HEAD_VERTEX_COUNT, parseHead, type HeadFile } from "../../src/sim/character/HeadFile.ts";
import type { Vec3 } from "../../src/sim/character/RigidMatrix.ts";
import { parseSkinnedMesh } from "../../src/sim/character/SkinnedMesh.ts";
import { ageMorphFromYears, ageYearsFromSlider, Attribute, buildInfoSm, INFO_SM_FIXED_SIZE, parseInfoSm, type StarInfo } from "../../src/sim/character/StarFile.ts";
import { haveGame, pakIndex } from "../helpers.ts";
import { CUSTOM_STAR_INFO_SM, DEFAULT_STAR_INFO_SM, fromHex, ZLIB_SAMPLE } from "./characterFixtures.ts";
import { nearD as near } from "./check.ts";

test("zlib streams (fflate)", () => {
  const want = "face rig ".repeat(40) + String.fromCharCode(...Array.from({ length: 256 }, (_, i) => i));
  assert.equal(new TextDecoder("latin1").decode(inflate(fromHex(ZLIB_SAMPLE))), new TextDecoder("latin1").decode(Uint8Array.from(want, (c) => c.charCodeAt(0))));
});

test("the star file", () => {
  const custom = parseInfoSm(fromHex(CUSTOM_STAR_INFO_SM));
  const def = parseInfoSm(fromHex(DEFAULT_STAR_INFO_SM));
  // the custom star, set up in the editor: head shape slider 0, skin tone 1, age 41, eyebrows 30, eye makeup 7, colour 10, facial hair 4, lipstick 0
  assert.equal(custom.name, "DaveJohn");
  assert.equal(custom.gender, 1);
  assert.deepEqual([custom.head0, custom.head1, custom.hair], ["head_m_white_hero2.hd", "head_m_indian_man2.hd", "hair_20s_m5.msh"]);
  near("head blend", custom.headBlend, 0, 1e-6);
  near("skin blend", custom.skinBlend, 1, 1e-6);
  near("age", ageYearsFromSlider(custom.ageSlider), 41, 0.5);
  assert.deepEqual([custom.eyebrow, custom.eyeMakeup, custom.makeupColour, custom.beard, custom.lipstick], [30, 7, 10, 4, 0]);
  near("looks", custom.attributes[Attribute.Looks]!, 0.3, 1e-6);
  near("trimness", custom.attributes[Attribute.Trimness]!, 1, 1e-6);
  near("slider 0", custom.sliders[0]!, 0.5, 1e-6);
  // the all-default star
  assert.ok(def.name === "Baseline" && def.head1 === "");
  near("default head blend", def.headBlend, 0.5, 1e-6);
  near("default skin blend", def.skinBlend, 0.5, 1e-6);
  assert.deepEqual([def.eyebrow, def.eyeMakeup, def.makeupColour, def.beard, def.lipstick], [1, 0, 1, 0, 0]);
  // the writer reproduces the files byte for byte
  assert.deepEqual(buildInfoSm(custom), fromHex(CUSTOM_STAR_INFO_SM));
  assert.deepEqual(buildInfoSm(def), fromHex(DEFAULT_STAR_INFO_SM));
  assert.equal(fromHex(CUSTOM_STAR_INFO_SM).length, INFO_SM_FIXED_SIZE + 2 * custom.name.length);
  const v3 = fromHex(DEFAULT_STAR_INFO_SM);
  v3[0] = 3;
  assert.throws(() => parseInfoSm(v3), /unsupported version/);
});

test("makeup, hair, iris and age rules", () => {
  assert.equal(makeupLayerFileName(MakeupCategory.MaleEyebrow, 0), "");
  assert.equal(makeupLayerFileName(MakeupCategory.MaleEyebrow, 1), "mup_meyebrow_v00.dds");
  assert.equal(makeupLayerFileName(MakeupCategory.MaleEyebrow, 30), "mup_meyebrow_v29.dds");
  assert.equal(makeupLayerFileName(MakeupCategory.Beard, 4), "mup_beard_v03.dds");
  assert.equal(makeupLayerFileName(MakeupCategory.Lips, 11), "mup_lips_v10.dds");
  assert.equal(makeupLayerFileName(MakeupCategory.EyeMakeupShape, 7), "mup_eyes_v06.dds");
  assert.equal(makeupLayerFileName(MakeupCategory.EyeMakeupColour, 10), "mup_eyes_v09.dds");
  assert.deepEqual([2, 3, 4, 5, 10, 11, 12, 13, 6].map(makeupCategoryForParamType), [1, 0, 2, 3, 5, 6, 7, 4, 8]);
  assert.equal(makeupOptionCount(13), 14);
  assert.deepEqual([0, 3, 5].map(hairColourSuffix), ["", "_rd", "_px"]);
  assert.equal(hairTextureFile("hair_20s_f1", 2), "hair_20s_f1_bk.dds");
  assert.deepEqual([irisUvOffset(0).u, irisUvOffset(6).u, irisUvOffset(6).v], [0, 0.5, 0.25]);
  near("age morph 18", ageMorphFromYears(18), 0, 1e-9);
  near("age morph 41", ageMorphFromYears(41), 0.275, 1e-6);
  near("age morph 80", ageMorphFromYears(80), 1, 1e-9);
  assert.ok(greyOverlayAlpha(0) === 0 && greyOverlayAlpha(1) === 255);
  assert.equal(expressionAnimationFile("head_m_white_joe.hd"), "fe_m_white_joe.anm");
  assert.equal(expressionAnimationFile("head_f_white_jane.hd"), "fe_f_white_jane.anm");
  assert.equal(expressionAnimationFile("hair_20s_m5.msh"), "");
  assert.deepEqual([100, 200, 300, 500].map(expressionEnvelope), [0.5, 1, 0.5, 0]);

  // the custom star's face layer plan: the eye pair, no lipstick, beard 4 with the age grey, eyebrows 30, the hair as a texture layer
  const plan = buildFaceLayerPlan(parseInfoSm(fromHex(CUSTOM_STAR_INFO_SM)), true);
  assert.equal(plan.length, 4);
  assert.ok(plan[0]!.file === "mup_eyes_v06.dds" && plan[0]!.colourFile === "mup_eyes_v09.dds");
  assert.ok(plan[1]!.file === "mup_beard_v03.dds" && plan[1]!.greyFile === "mup_beard_v03_gy.dds");
  assert.equal(plan[1]!.greyAlpha, 67); // age 41 -> morph 0.264 (the slider is 0.48...), x 255
  assert.equal(plan[2]!.file, "mup_meyebrow_v29.dds");
  assert.ok(plan[3]!.file === "hair_20s_m5.dds" && plan[3]!.greyFile === "hair_20s_m5_gy.dds");
  // the default star: eyebrow 1 (v00) and the hair layer; no makeup, beard or lipstick; the colour alone draws nothing
  assert.equal(buildFaceLayerPlan(parseInfoSm(fromHex(DEFAULT_STAR_INFO_SM)), true).length, 2);

  // .fan: kiss is frame 14 at intensity 1.0, kiss_50 the same frame at 0.5
  const fan = parseFan(Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0, 14, 0, 0, 0, 0, 0, 0, 0x3f, 0, 0, 0, 0, 0x0e, 0x27, 0, 0, 0, 0, 0, 0]))!;
  assert.ok(fan.entries === 1 && fan.frame === 14 && fan.flagWord === 9998);
  near("intensity", fan.intensity, 0.5, 1e-9);
});

test("the .hd morph", () => {
  const head = (base: Vec3): HeadFile => {
    const fill = (p: Vec3, n: Vec3) => { const a = new Float32Array(HEAD_VERTEX_COUNT * 6); for (let i = 0; i < HEAD_VERTEX_COUNT; i++) a.set([...p, ...n], 6 * i); return a; };
    return { names: ["", "", "", ""], a: fill(base, [0, 0, 1]), b: fill([0.1, 0, 0], [0, 0, 0]), c: fill([0, 0.2, 0], [0, 0, 0]), header: new Uint8Array(0x94) };
  };
  const a = head([1, 2, 3]), b = head([3, 2, 1]);
  let out = applyHdMorph(a, null, 0, 0.5, 1); // A + weight * B + age * C
  near("x", out[6 * 7]!, 1.05, 1e-6);
  near("y", out[6 * 7 + 1]!, 2.2, 1e-6);
  near("z", out[6 * 7 + 2]!, 3, 1e-6);
  out = applyHdMorph(a, b, 0.25, 0, 0); // (1 - mix) * first + mix * second
  near("mixed x", out[0]!, 1.5, 1e-6);
  near("mixed z", out[2]!, 2.5, 1e-6);
  near("normals renormalised", out[5]!, 1, 1e-6);
});

/** Stars saved in the editor, each as its info.sm and star.hd. */
function savedStars(): { info: StarInfo; hd: HeadFile }[] {
  if (!existsSync(STAR_DIR)) return [];
  return readdirSync(STAR_DIR).flatMap((d) => {
    try {
      return [{ info: parseInfoSm(new Uint8Array(readFileSync(join(STAR_DIR, d, "info.sm")))), hd: parseHead(new Uint8Array(readFileSync(join(STAR_DIR, d, "star.hd")))) }];
    } catch {
      return [];
    }
  });
}

/** Everything at the editor's defaults (male), apart from the face sliders. */
const defaultLooks = (s: StarInfo) =>
  s.gender === 1 && s.headBlend === 0.5 && s.skinBlend === 0.5 && s.eyebrow === 1 && s.eyeMakeup === 0 && s.beard === 0 && s.lipstick === 0 && s.head1 === "";
const movedSliders = (s: StarInfo) => s.sliders.filter((v) => v !== SLIDER_NEUTRAL).length;

const read = async (name: string, dirHint?: string) => {
  const bytes = await (await pakIndex()).readByName(name, dirHint ? { dirHint } : {});
  assert.ok(bytes, `${name} in the archives`);
  return bytes;
};

test("the face sliders against saved stars (STARMAKER.md section 7)", { skip: haveGame ? false : "needs the game archives (OTM_GAME_DIR)" }, async (t) => {
  const anm = parseAnm(await read("mannequin_sm.anm"));
  const msh = parseSkinnedMesh(await read("sm_generic.msh"));
  assert.ok(anm.frameCount === 134 && anm.channelCount === 108);
  assert.ok(msh.bones.length === 108 && msh.primitives.length === 3);
  assert.deepEqual(msh.primitives.map((p) => p.vertices.length), [760, 58, 178]);
  const rig = new FaceRig(msh, anm);
  assert.equal(rig.vertexCount, HEAD_VERTEX_COUNT);
  const ini = join(GAME_DIR ?? "", "Data", "StarMaker", "starmaker.ini"); // a loose file in the install, not in the archives
  assert.ok(existsSync(ini), ini);
  const defs = parseSliderIni(readFileSync(ini, "latin1"));
  assert.equal(defs.length, 43);
  assert.ok(defs[0]!.name === "nose_length" && defs[0]!.firstFrame === 1 && defs[0]!.axis === 2);
  assert.ok(defs[22]!.name === "teeth_move_in_out" && defs[22]!.firstFrame === 130);
  near("frame at 0.5", sliderFrame(defs[0]!, 0.5), 1.995, 1e-5);
  near("frame at 1", sliderFrame(defs[0]!, 1), 2.99, 1e-5);

  const stars = savedStars();
  const def = stars.find((s) => defaultLooks(s.info) && movedSliders(s.info) === 0);
  const nine = stars.find((s) => defaultLooks(s.info) && movedSliders(s.info) === 9);
  if (!def || !nine) return t.skip(`needs an all-default star and a nine-slider star saved in the editor (${STAR_DIR})`);
  const pos = (h: Float32Array, i: number): Vec3 => [h[6 * i]!, h[6 * i + 1]!, h[6 * i + 2]!];
  const start = Array.from({ length: HEAD_VERTEX_COUNT }, (_, i) => pos(def.hd.a, i));
  const predicted = applyFaceSliders(rig, defs, nine.info.sliders, start, "deltaFromNeutral");
  let sumSq = 0, maxErr = 0, sumObs = 0, moved = 0, predictedMoved = 0;
  for (let i = 0; i < HEAD_VERTEX_COUNT; i++) {
    let e2 = 0, o2 = 0, p2 = 0;
    for (let j = 0; j < 3; j++) {
      const obs = pos(nine.hd.a, i)[j]! - start[i]![j]!;
      const pred = predicted[i]![j]! - start[i]![j]!;
      e2 += (obs - pred) ** 2;
      o2 += obs * obs;
      p2 += pred * pred;
    }
    sumSq += e2;
    sumObs += o2;
    maxErr = Math.max(maxErr, Math.sqrt(e2));
    if (Math.sqrt(o2) > 1e-5) moved++;
    if (Math.sqrt(p2) > 1e-5) predictedMoved++;
  }
  const rms = Math.sqrt(sumSq / HEAD_VERTEX_COUNT), rmsObs = Math.sqrt(sumObs / HEAD_VERTEX_COUNT);
  assert.ok(moved === 457 && predictedMoved === 457, `${moved} vertices moved, ${predictedMoved} predicted`);
  assert.ok(rmsObs > 0.004);
  assert.ok(rms < 0.0001, `rms error ${rms}`); // 0.1 mm
  assert.ok(maxErr < 0.0003, `max error ${maxErr}`);
  // the editor's own rule (each pass replaces the positions) applied to the head the default star was made from reproduces it to about 1.2 mm
  // (a nearly constant ~1 mm shift is left over; STARMAKER.md section 10)
  const joe = parseHead(await read("head_m_white_joe.hd", "heads"));
  const p = applyFaceSliders(rig, defs, def.info.sliders, Array.from({ length: HEAD_VERTEX_COUNT }, (_, i) => pos(joe.a, i)), "replace");
  let s2 = 0;
  for (let i = 0; i < HEAD_VERTEX_COUNT; i++) for (let j = 0; j < 3; j++) s2 += (p[i]![j]! - pos(def.hd.a, i)[j]!) ** 2;
  assert.ok(Math.sqrt(s2 / (HEAD_VERTEX_COUNT * 3)) < 0.0015);
});

test("facial expressions: the frames move the bones the names say (STARMAKER.md section 8)", { skip: haveGame ? false : "needs the game archives (OTM_GAME_DIR)" }, async () => {
  const anm = parseAnm(await read("fe_m_white_joe.anm"));
  const msh = parseSkinnedMesh(await read("generic_facialskin.msh"));
  assert.ok(anm.frameCount === EXPRESSION_FRAME_COUNT && anm.channelCount === 35);
  assert.equal(msh.bones.length, 65);
  const rig = new FaceRig(msh, anm);
  const bind = rig.bindPositions();
  const smile = applyExpression(rig, bind, 1, 1);
  const blinkRight = applyExpression(rig, bind, 29, 1);
  const half = applyExpression(rig, bind, 1, 0.5);
  const dist = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  let smileMove = 0, halfMove = 0, blinkLeftSide = 0, blinkRightSide = 0;
  bind.forEach((b, i) => {
    // the mouth region (z 1.60..1.68, |y| < 0.07) moves with a smile; at intensity 0.5 half as much
    if (b[2] > 1.6 && b[2] < 1.68 && Math.abs(b[1]) < 0.07) {
      smileMove += dist(smile[i]!, b);
      halfMove += dist(half[i]!, b);
    }
    if (b[2] > 1.7) {
      if (b[1] < -0.01) blinkRightSide += dist(blinkRight[i]!, b);
      else if (b[1] > 0.01) blinkLeftSide += dist(blinkRight[i]!, b);
    }
  });
  assert.ok(smileMove > 0.01);
  near("half intensity moves half as much", halfMove, smileMove / 2, smileMove * 0.02);
  assert.ok(blinkRightSide > 5 * blinkLeftSide, "blinkright (frame 29) closes only the right eyelid (negative y)");
});
