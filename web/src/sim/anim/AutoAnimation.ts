import { anmDurationMs, anmFramePosition, type Anm } from "../../formats/Anm.ts";
import type { Msh, MshBone } from "../../formats/Msh.ts";

/**
 * Auto-animated models: props and buildings whose mesh is skinned and has `aa_<model>_v00.anm` (plus `_v01`, ...) beside it, such as the lot gate's and
 * the flag prop's flags, which wave in the wind (docs/AUTO_ANIMATION.md).
 *
 * How the original does it [read: orig 0x009820A0 `Object_StartAutoAnimation`, 0x00980250 `Object_PlayRandomAnimation`, 0x009A3A80 `AutoAnimated_StepAll`]:
 *   - when an object whose mesh has flag 0x800 is first shown, one of the model's clips is chosen at random and looped;
 *   - once per **rendered frame** (from 0x009A5090 `Frame_PresentationUpdate`, the per-frame update, not from the 10 Hz simulation tick) every playing clip's time
 *     moves on by the real elapsed milliseconds (`DAT_0105becc`, 5..99 ms), so the animation ignores the game speed and the pause;
 *   - when the time wraps past the clip's length a new random clip is chosen.
 * Here that is `AutoAnimator.step(dtMs)`.
 */

/** 3x3 matrices are row-major `number[9]`; the game uses row vectors, so a point transforms as `p * M`. */
type Mat3 = number[];

const mul3 = (a: Mat3, b: Mat3): Mat3 => {
  const o = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j]! += a[i * 3 + k]! * b[k * 3 + j]!;
  return o;
};
const transpose3 = (a: Mat3): Mat3 => [a[0]!, a[3]!, a[6]!, a[1]!, a[4]!, a[7]!, a[2]!, a[5]!, a[8]!];
/** Row vector times matrix. */
const vecMul = (x: number, y: number, z: number, m: Mat3): [number, number, number] => [
  x * m[0]! + y * m[3]! + z * m[6]!,
  x * m[1]! + y * m[4]! + z * m[7]!,
  x * m[2]! + y * m[5]! + z * m[8]!,
];

/** Euler angles (x, y, z) to the rotation matrix the game uses (`Matrix3_FromEulerAngles`, docs/ANM_FORMAT.md): the rows are the bone's axes in its parent's frame. */
export function eulerMatrix(ax: number, ay: number, az: number): Mat3 {
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  return [
    cy * cz, cy * sz, -sy,
    sx * sy * cz - cx * sz, cx * cz + sx * sy * sz, sx * cy,
    sx * sz + sy * cx * cz, sy * cx * sz - sx * cz, cx * cy,
  ];
}

/**
 * How a clip's pose is applied to the bind pose.
 *   - `rebased`: the clip's rotations are taken relative to its own first frame and applied on top of the model's bind pose, so frame 0 looks like
 *     the model as built. [guess] This is the default because the flag clips' frame-0 pose does not equal the bind pose (the clip's bone offsets differ
 *     from the model's by 10 %, and used as they are the cloth ends up 0.8 units below the pole).
 *   - `absolute`: the clip's local rotations and translations replace the bind pose's. Kept to compare by eye against the original.
 */
export type PoseMode = "rebased" | "absolute";

/** One bone's pose in model space: its axes (rows) and origin. */
interface BonePose { rot: Mat3; pos: [number, number, number]; }

/** The clip's Euler angles (x, y, z) of one channel at a fractional frame (blended linearly between the two stored frames). */
function localAngles(a: Anm, channel: number, frame: number): [number, number, number] {
  const f0 = Math.min(Math.floor(frame), a.nFrames - 1);
  const f1 = f0 + 1 < a.nFrames ? f0 + 1 : 0; // the last frame equals the first: loop
  const u = frame - f0;
  const g = (f: number, k: number) => a.angles[(f * a.nChannels + channel) * 3 + k]!;
  const ang = (k: number) => g(f0, k) + (g(f1, k) - g(f0, k)) * u;
  return [ang(0), ang(1), ang(2)];
}

/** The clip's local rotation of one channel at a fractional frame. */
function localRotation(a: Anm, channel: number, frame: number): Mat3 {
  const [x, y, z] = localAngles(a, channel, frame);
  return eulerMatrix(x, y, z);
}

/** An angle moved toward another by `w` along the shorter way round (the stored angles are wrapped to a turn). */
function lerpAngle(from: number, to: number, w: number): number {
  const d = ((to - from + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return from + d * w;
}

function localTranslation(a: Anm, channel: number, frame: number): [number, number, number] {
  const f0 = Math.min(Math.floor(frame), a.nFrames - 1);
  const f1 = f0 + 1 < a.nFrames ? f0 + 1 : 0;
  const u = frame - f0;
  const g = (f: number, k: number) => a.translations[(f * a.nChannels + channel) * 3 + k]!;
  const t = (k: number) => g(f0, k) + (g(f1, k) - g(f0, k)) * u;
  return [t(0), t(1), t(2)];
}

/**
 * A cross-fade out of an earlier clip: `weight` is the share of `clip` (the one being left) in the pose, 1 = still that pose, 0 = only the clip being posed. Only for the `absolute`
 * mode (people); angles are blended the short way round, translations linearly.
 */
export interface PoseMix { clip: Anm; frame: number; weight: number; }

/** The model-space pose of every bone at a fractional frame of a clip, optionally cross-faded with another clip. Bones are stored parents-first. */
export function poseBones(skeleton: MshBone[], clip: Anm, frame: number, mode: PoseMode = "rebased", mix?: PoseMix): BonePose[] {
  const out: BonePose[] = [];
  for (let b = 0; b < skeleton.length; b++) {
    const bone = skeleton[b]!;
    const parent = bone.parent >= 0 ? out[bone.parent]! : null;
    const bindRot = bone.rot as Mat3;
    let local: Mat3;
    let offset: [number, number, number];
    if (mode === "absolute") {
      if (mix && mix.weight > 0) {
        const to = localAngles(clip, b, frame), from = localAngles(mix.clip, b, mix.frame);
        const w = mix.weight;
        local = eulerMatrix(lerpAngle(to[0], from[0], w), lerpAngle(to[1], from[1], w), lerpAngle(to[2], from[2], w));
        const tt = localTranslation(clip, b, frame), tf = localTranslation(mix.clip, b, mix.frame);
        offset = [tt[0] + (tf[0] - tt[0]) * w, tt[1] + (tf[1] - tt[1]) * w, tt[2] + (tf[2] - tt[2]) * w];
      } else {
        local = localRotation(clip, b, frame);
        offset = localTranslation(clip, b, frame);
      }
    } else {
      // bind local pose from the model's world bind poses, the clip's rotation change since its first frame on top
      const pb = bone.parent >= 0 ? skeleton[bone.parent]! : null;
      const lb = pb ? mul3(bindRot, transpose3(pb.rot as Mat3)) : bindRot;
      offset = pb ? vecMul(bone.pos[0] - pb.pos[0], bone.pos[1] - pb.pos[1], bone.pos[2] - pb.pos[2], transpose3(pb.rot as Mat3)) : [0, 0, 0];
      local = mul3(mul3(lb, transpose3(localRotation(clip, b, 0))), localRotation(clip, b, frame));
    }
    if (!parent) {
      out.push({ rot: local, pos: mode === "absolute" ? offset : [bone.pos[0], bone.pos[1], bone.pos[2]] });
    } else {
      const p = vecMul(offset[0], offset[1], offset[2], parent.rot);
      out.push({ rot: mul3(local, parent.rot), pos: [p[0] + parent.pos[0], p[1] + parent.pos[1], p[2] + parent.pos[2]] });
    }
  }
  return out;
}

/**
 * One bone's skinning transform, flattened: a bind-pose point `p` goes to `p * rot + move`, i.e. into the bone's bind frame and out again by the posed bone
 * (`rot` = bindRot^T * posedRot, `move` = (-bindPos * bindRot^T) * posedRot + posedPos; row-vector convention).
 */
export interface SkinTransform { rot: Float64Array; move: Float64Array; }

/** The skinning transforms of every bone for a pose. Build once per pose, then skin any number of vertex sets with `skinVertices`. */
export function skinTransforms(skeleton: MshBone[], pose: BonePose[]): SkinTransform[] {
  return skeleton.map((bone, b) => {
    const inv = transpose3(bone.rot as Mat3);
    const posed = pose[b]!;
    const rot = mul3(inv, posed.rot);
    const o = vecMul(-bone.pos[0], -bone.pos[1], -bone.pos[2], inv);
    const m = vecMul(o[0], o[1], o[2], posed.rot);
    return { rot: Float64Array.from(rot), move: Float64Array.from([m[0] + posed.pos[0], m[1] + posed.pos[1], m[2] + posed.pos[2]]) };
  });
}

/**
 * Skin one primitive's bind-pose vertices with a pose: each vertex goes into the local frame of each bone that holds it (bind pose), out again by the
 * posed bone, and the results are blended by the weights. Writes positions and normals (model space, z up) into `outPositions` / `outNormals`.
 * No allocation inside the loop: people are skinned every frame.
 */
export function skinVertices(
  transforms: SkinTransform[],
  bind: { positions: Float32Array; normals: Float32Array; skin: { weights: Float32Array; bones: Uint8Array } },
  outPositions: Float32Array, outNormals: Float32Array,
): void {
  const n = bind.positions.length / 3;
  const P = bind.positions, N = bind.normals, W = bind.skin.weights, B = bind.skin.bones;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3]!, y = P[i * 3 + 1]!, z = P[i * 3 + 2]!;
    const nx0 = N[i * 3]!, ny0 = N[i * 3 + 1]!, nz0 = N[i * 3 + 2]!;
    let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 4; k++) {
      const w = W[i * 4 + k]!;
      if (w === 0) continue;
      const t = transforms[B[i * 4 + k]!];
      if (!t) continue;
      const r = t.rot, m = t.move;
      px += w * (x * r[0]! + y * r[3]! + z * r[6]! + m[0]!);
      py += w * (x * r[1]! + y * r[4]! + z * r[7]! + m[1]!);
      pz += w * (x * r[2]! + y * r[5]! + z * r[8]! + m[2]!);
      nx += w * (nx0 * r[0]! + ny0 * r[3]! + nz0 * r[6]!);
      ny += w * (nx0 * r[1]! + ny0 * r[4]! + nz0 * r[7]!);
      nz += w * (nx0 * r[2]! + ny0 * r[5]! + nz0 * r[8]!);
    }
    outPositions[i * 3] = px; outPositions[i * 3 + 1] = py; outPositions[i * 3 + 2] = pz;
    const len = Math.hypot(nx, ny, nz) || 1;
    outNormals[i * 3] = nx / len; outNormals[i * 3 + 1] = ny / len; outNormals[i * 3 + 2] = nz / len;
  }
}

/** Whether a clip animates this skeleton: same bone count and the same parents (the channels are the bones, in order). */
export function clipFits(skeleton: MshBone[], clip: Anm): boolean {
  return skeleton.length === clip.nChannels && skeleton.every((b, i) => b.parent === clip.parents[i]);
}

/** The longest frame time the original steps by in one render frame [read, `DAT_0105becc` is clamped to 5..99 ms]. */
export const MAX_FRAME_MS = 99;

/**
 * The playing state of one auto-animated model: which of its clips is looping and how far in. Every instance of the model shares it (the original gives
 * each object its own clip choice and phase; sharing keeps the whole lot's flags in step, which is a known simplification).
 */
export class AutoAnimator {
  /** Indices of the model's skinned primitives, and for each the skinned positions and normals (model space, z up) after the last `step`. */
  readonly skinned: { primitive: number; positions: Float32Array; normals: Float32Array }[] = [];
  private clipIndex = 0;
  private timeMs = 0;
  private readonly msh: Msh;
  private readonly clips: Anm[];
  private readonly random: () => number;
  private readonly mode: PoseMode;

  constructor(msh: Msh, clips: Anm[], random: () => number = Math.random, mode: PoseMode = "rebased") {
    this.msh = msh;
    this.clips = clips;
    this.random = random;
    this.mode = mode;
    msh.primitives.forEach((p, i) => {
      if (p.skin) this.skinned.push({ primitive: i, positions: new Float32Array(p.positions.length), normals: new Float32Array(p.normals.length) });
    });
    this.pickClip();
    this.pose();
  }

  /** The clip now playing (an index into the clips given to the constructor). */
  get clip(): number { return this.clipIndex; }

  /** orig: 0x00980250 `Object_PlayRandomAnimation`: a uniformly random clip of the model's set. */
  private pickClip(): void {
    this.clipIndex = Math.min(this.clips.length - 1, Math.floor(this.random() * this.clips.length));
  }

  /**
   * Move on by the real time since the last rendered frame and recompute the skinned vertices. Returns true when the clip wrapped (and a new random one
   * was chosen). `dtMs` is wall-clock time: pausing the game or changing its speed does not change it.
   */
  step(dtMs: number): boolean {
    const clip = this.clips[this.clipIndex]!;
    this.timeMs += Math.min(Math.max(dtMs, 0), MAX_FRAME_MS);
    let wrapped = false;
    const dur = anmDurationMs(clip);
    if (this.timeMs >= dur) {
      this.timeMs %= dur;
      this.pickClip();
      wrapped = true;
    }
    this.pose();
    return wrapped;
  }

  private pose(): void {
    const clip = this.clips[this.clipIndex]!;
    const pose = poseBones(this.msh.skeleton, clip, anmFramePosition(clip, this.timeMs), this.mode);
    const transforms = skinTransforms(this.msh.skeleton, pose);
    for (const s of this.skinned) {
      const p = this.msh.primitives[s.primitive]!;
      skinVertices(transforms, { positions: p.positions, normals: p.normals, skin: p.skin! }, s.positions, s.normals);
    }
  }
}
