// The face rig: a skeleton of face bones posed from an animation, with the head mesh skinned to it (4 weights per vertex).
//
// Two users share it (docs/STARMAKER.md sections 7 and 8):
//   * the StarMaker face sliders: sm_generic.msh (108 bones) + mannequin_sm.anm (frame 0 = the base pose; a slider owns frames a, a+1, a+2 = minimum,
//     neutral, maximum, and its value v selects the frame a + 1.99 * v);
//   * facial expressions (.fan files): generic_facialskin.msh (65 bones: 30 body + 35 face) + the head's fe_<head>.anm (53 frames, one per expression
//     index, 35 channels = the face bones), blended with an intensity.
//
// From StarMaker's slider code (StarMaker_ApplyAllSliders 0x0040EDD9, FaceSlider_PoseAtValue 0x004066A1, FaceSlider_SkinHeadAtValue 0x0040676B) and the
// shared pose code (AnimInstance_EvaluatePose, game 0x00A03C40). The game's own use for expressions is FaceController_SetExpression (0x00A304F0) and its
// update functions (0x00A30990, 0x00A30CB0).
import type { AnmFile } from "./AnmFile.ts";
import { identity, inverseRigid, multiply, transform, type RigidMatrix, type Vec3 } from "./RigidMatrix.ts";
import type { SkinnedMesh, SkinRecord } from "./SkinnedMesh.ts";

/**
 * One line of Data\StarMaker\starmaker.ini: `[group] [name] [a][b]`. `a` is the slider's first animation frame (not 1 + 3 * index: the ini has gaps,
 * e.g. teeth_move_in_out has a = 130), `b` the colour of the arrow in the slider's picture (0 x, 1 y, 2 z): not part of the mechanism.
 */
export interface SliderDef {
  group: string;
  name: string;
  firstFrame: number;
  axis: number;
}

export const SLIDER_COUNT = 43;
export const SLIDER_NEUTRAL = 0.5;

/** orig: StarMaker_ParseSliderIni 0x00406354 (editor only) */
export function parseSliderIni(text: string): SliderDef[] {
  const out: SliderDef[] = [];
  for (const line of text.split("\n")) {
    const fields = [...line.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1]!);
    if (fields.length < 4) continue;
    out.push({ group: fields[0]!, name: fields[1]!, firstFrame: parseInt(fields[2]!, 10) || 0, axis: parseInt(fields[3]!, 10) || 0 });
  }
  return out;
}

/** The animation frame of a slider at a value in [0, 1]: a + 1.99 * v (the game stores frames in hundredths: a * 100 - round(v * -199)). orig: 0x004066A1 */
export const sliderFrame = (s: SliderDef, value: number) => s.firstFrame + 1.99 * value;

export class FaceRig {
  readonly mesh: SkinnedMesh;
  readonly anim: AnmFile;
  private readonly skin: SkinRecord[] = [];
  private readonly invBind: RigidMatrix[];
  private readonly firstAnimated: number;

  /** The mesh needs skin records on every primitive; the animation's channels map to the mesh's LAST bones. */
  constructor(mesh: SkinnedMesh, anim: AnmFile) {
    this.mesh = mesh;
    this.anim = anim;
    for (const p of mesh.primitives) {
      if (p.skin.length !== p.vertices.length) throw new Error("a primitive has no skin records");
      this.skin.push(...p.skin);
    }
    if (mesh.bones.length === 0 || mesh.bones.length < anim.channelCount) throw new Error("mesh has fewer bones than the animation has channels");
    this.firstAnimated = mesh.bones.length - anim.channelCount;
    this.invBind = mesh.bones.map((b) => inverseRigid(b.bindWorld));
  }

  get vertexCount(): number {
    return this.skin.length;
  }

  /** The mesh's own vertex positions (the bind shape), concatenated over the primitives. */
  bindPositions(): Vec3[] {
    return this.mesh.primitives.flatMap((p) => p.vertices.map((v) => [...v.pos] as Vec3));
  }

  /**
   * The skin matrices (inverse bind world x current world) at a fractional frame: the two neighbouring frames are interpolated linearly (rotations and
   * translations), then chained up the bone tree. Body bones stay at their bind pose.
   * orig: AnimInstance_EvaluatePose 0x00A03C40 (the sampling), Mesh_GetPrimitiveSkinRecords 0x009D9D50 (the weights)
   */
  skinMatrices(frame: number): RigidMatrix[] {
    const last = this.anim.frameCount - 1;
    if (frame < 0) frame = 0;
    const f0 = Math.min(Math.floor(frame), last);
    const f1 = Math.min(f0 + 1, last);
    const u = frame - f0;
    const world = this.mesh.bones.map((b) => b.bindWorld);
    for (let c = 0; c < this.anim.channelCount; c++) {
      const a = this.anim.frames[f0]![c]!, b = this.anim.frames[f1]![c]!;
      const local = identity();
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) local.r[i]![j] = a.r[i]![j]! * (1 - u) + b.r[i]![j]! * u;
      for (let k = 0; k < 3; k++) local.t[k] = a.t[k]! * (1 - u) + b.t[k]! * u;
      const bone = this.firstAnimated + c;
      // an animation parent is a channel index; without one the channel is local to the mesh skeleton's parent bone
      const parent = this.anim.parents[c]! >= 0 ? this.firstAnimated + this.anim.parents[c]! : this.mesh.bones[bone]!.parent;
      world[bone] = parent < 0 ? local : multiply(local, world[parent]!);
    }
    return world.map((w, i) => multiply(this.invBind[i]!, w));
  }

  /** The weighted sum of each vertex moved by its four bones' skin matrices at the frame. */
  skinPositions(positions: readonly Vec3[], frame: number): Vec3[] {
    const s = this.skinMatrices(frame);
    return positions.map((p, v) => {
      const acc: Vec3 = [0, 0, 0];
      const rec = this.skin[v]!;
      for (let k = 0; k < 4; k++) {
        const w = rec.weight[k]!;
        if (w === 0) continue;
        const q = transform(p, s[rec.bone[k]!]!);
        for (let j = 0; j < 3; j++) acc[j] += w * q[j]!;
      }
      return acc;
    });
  }
}

/**
 * How sliders are applied. "replace" is what the editor does: each slider's pass REPLACES the positions with the skinned ones at its frame, in ini
 * order (the neutral frame is not exactly the identity, so 43 neutral passes add up to about a millimetre). "deltaFromNeutral" adds the change a slider
 * makes relative to its neutral frame (a + 1): what a difference between two saved stars shows, used to check the sliders against saved star.hd files.
 */
export type SliderMode = "replace" | "deltaFromNeutral";

/** Applies the sliders (values in ini order, 0.5 = neutral) to the head positions. orig: StarMaker_ApplyAllSliders 0x0040EDD9 */
export function applyFaceSliders(rig: FaceRig, defs: readonly SliderDef[], values: readonly number[], positions: Vec3[], mode: SliderMode): Vec3[] {
  for (let i = 0; i < defs.length && i < SLIDER_COUNT; i++) {
    // a difference between two saved stars already contains the neutral passes of both: only the sliders that were moved count
    if (mode === "deltaFromNeutral" && values[i] === SLIDER_NEUTRAL) continue;
    const frame = sliderFrame(defs[i]!, values[i]!);
    if (mode === "replace") positions = rig.skinPositions(positions, frame);
    else {
      const moved = rig.skinPositions(positions, frame);
      const neutral = rig.skinPositions(positions, defs[i]!.firstFrame + 1);
      positions = positions.map((p, v) => [0, 1, 2].map((j) => p[j]! + moved[v]![j]! - neutral[v]![j]!) as Vec3);
    }
  }
  return positions;
}

/**
 * A facial expression: the positions moved to frame `expressionFrame` of the head's expression animation, blended by intensity (0 = unchanged, 1 = the
 * full pose). The blending rule is the port's choice (linear towards the bind pose); the game scales the pose weight by an envelope.
 * orig: FaceController_SetExpression 0x00A304F0 (selection), FUN_00A30CB0 (weighting)
 */
export function applyExpression(rig: FaceRig, positions: readonly Vec3[], expressionFrame: number, intensity: number): Vec3[] {
  const posed = rig.skinPositions(positions, expressionFrame);
  return positions.map((p, v) => [0, 1, 2].map((j) => p[j]! + intensity * (posed[v]![j]! - p[j]!)) as Vec3);
}

/** The face controller's envelope: ticks 0..200 rise, 200..400 fall (weight 0..1..0); the stored scale is 0.005 per tick. orig: FUN_00A30CB0 */
export function expressionEnvelope(ticks: number): number {
  if (ticks <= 0 || ticks >= 400) return 0;
  return Math.fround(ticks >= 200 ? 1 - (ticks - 200) * 0.005 : ticks * 0.005);
}
