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

/** The clip's local rotation of one channel at a fractional frame (angles blended linearly between the two stored frames). */
function localRotation(a: Anm, channel: number, frame: number): Mat3 {
  const f0 = Math.min(Math.floor(frame), a.nFrames - 1);
  const f1 = f0 + 1 < a.nFrames ? f0 + 1 : 0; // the last frame equals the first: loop
  const u = frame - f0;
  const g = (f: number, k: number) => a.angles[(f * a.nChannels + channel) * 3 + k]!;
  const ang = (k: number) => g(f0, k) + (g(f1, k) - g(f0, k)) * u;
  return eulerMatrix(ang(0), ang(1), ang(2));
}

function localTranslation(a: Anm, channel: number, frame: number): [number, number, number] {
  const f0 = Math.min(Math.floor(frame), a.nFrames - 1);
  const f1 = f0 + 1 < a.nFrames ? f0 + 1 : 0;
  const u = frame - f0;
  const g = (f: number, k: number) => a.translations[(f * a.nChannels + channel) * 3 + k]!;
  const t = (k: number) => g(f0, k) + (g(f1, k) - g(f0, k)) * u;
  return [t(0), t(1), t(2)];
}

/** The model-space pose of every bone at a fractional frame of a clip. Bones are stored parents-first. */
export function poseBones(skeleton: MshBone[], clip: Anm, frame: number, mode: PoseMode = "rebased"): BonePose[] {
  const out: BonePose[] = [];
  for (let b = 0; b < skeleton.length; b++) {
    const bone = skeleton[b]!;
    const parent = bone.parent >= 0 ? out[bone.parent]! : null;
    const bindRot = bone.rot as Mat3;
    let local: Mat3;
    let offset: [number, number, number];
    if (mode === "absolute") {
      local = localRotation(clip, b, frame);
      offset = localTranslation(clip, b, frame);
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
 * Skin one primitive's bind-pose vertices with a pose: each vertex goes into the local frame of each bone that holds it (bind pose), out again by the
 * posed bone, and the results are blended by the weights. Writes positions and normals (model space, z up) into `outPositions` / `outNormals`.
 */
export function skinVertices(
  skeleton: MshBone[], pose: BonePose[],
  bind: { positions: Float32Array; normals: Float32Array; skin: { weights: Float32Array; bones: Uint8Array } },
  outPositions: Float32Array, outNormals: Float32Array,
): void {
  const n = bind.positions.length / 3;
  const inv = skeleton.map((b) => transpose3(b.rot as Mat3));
  for (let i = 0; i < n; i++) {
    let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 4; k++) {
      const w = bind.skin.weights[i * 4 + k]!;
      if (w === 0) continue;
      const b = bind.skin.bones[i * 4 + k]!;
      const bone = skeleton[b];
      const posed = pose[b];
      if (!bone || !posed) continue;
      const local = vecMul(bind.positions[i * 3]! - bone.pos[0], bind.positions[i * 3 + 1]! - bone.pos[1], bind.positions[i * 3 + 2]! - bone.pos[2], inv[b]!);
      const q = vecMul(local[0], local[1], local[2], posed.rot);
      px += w * (q[0] + posed.pos[0]); py += w * (q[1] + posed.pos[1]); pz += w * (q[2] + posed.pos[2]);
      const ln = vecMul(bind.normals[i * 3]!, bind.normals[i * 3 + 1]!, bind.normals[i * 3 + 2]!, inv[b]!);
      const qn = vecMul(ln[0], ln[1], ln[2], posed.rot);
      nx += w * qn[0]; ny += w * qn[1]; nz += w * qn[2];
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
    for (const s of this.skinned) {
      const p = this.msh.primitives[s.primitive]!;
      skinVertices(this.msh.skeleton, pose, { positions: p.positions, normals: p.normals, skin: p.skin! }, s.positions, s.normals);
    }
  }
}
