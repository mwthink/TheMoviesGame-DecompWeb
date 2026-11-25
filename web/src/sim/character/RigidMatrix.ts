// A 3x3 matrix plus a translation, in the game's row-vector convention: p' = p * rows + t. The face rig only uses rotations and translations.

export type Vec3 = [number, number, number];

export interface RigidMatrix {
  /** three rows */
  r: [Vec3, Vec3, Vec3];
  t: Vec3;
}

export const identity = (): RigidMatrix => ({ r: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0] });

/** a applied first, then b (like the 3x4 matrix products in the animation pose evaluation, AnimInstance_EvaluatePose 0x00A03C40). */
export function multiply(a: RigidMatrix, b: RigidMatrix): RigidMatrix {
  const m = identity();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m.r[i]![j] = a.r[i]![0] * b.r[0]![j]! + a.r[i]![1] * b.r[1]![j]! + a.r[i]![2] * b.r[2]![j]!;
  for (let j = 0; j < 3; j++) m.t[j] = a.t[0] * b.r[0]![j]! + a.t[1] * b.r[1]![j]! + a.t[2] * b.r[2]![j]! + b.t[j]!;
  return m;
}

/** The inverse of a rigid (rotation + translation) matrix. */
export function inverseRigid(m: RigidMatrix): RigidMatrix {
  const inv = identity();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) inv.r[i]![j] = m.r[j]![i]!;
  for (let j = 0; j < 3; j++) inv.t[j] = -(m.t[0] * inv.r[0]![j]! + m.t[1] * inv.r[1]![j]! + m.t[2] * inv.r[2]![j]!);
  return inv;
}

export function transform(p: Vec3, m: RigidMatrix): Vec3 {
  const q: Vec3 = [0, 0, 0];
  for (let j = 0; j < 3; j++) q[j] = p[0] * m.r[0]![j]! + p[1] * m.r[1]![j]! + p[2] * m.r[2]![j]! + m.t[j]!;
  return q;
}
