import { unwrapZcmp } from "../assets/inflate.ts";

/**
 * An animation sequence (`.seq`, `Data\Animations\Sequences\`): a list of clip names the game picks among at random, for idles and reactions
 * (`staff_idle.seq`, `ai_hired.seq`). Layout [data]: six u32 (version 2 or 3, 1, the count of clips, a flag, 0, a blend time in ms), then the clip names NUL-terminated
 * (one more than the count when the flag is 1: the base idle that plays between the others), then one f32 per clip (all 1.0 in most files; `staff_idle` has
 * 1, 1, 1, 1, 0.57, 0.09, 0.07 and then 1.0 for the base idle).
 */
export interface Seq {
  /** The clips to choose among. */
  clips: string[];
  /** The weight of each clip (same length). */
  weights: number[];
  /** The idle that plays in between (when the file has one), else null. */
  baseIdle: string | null;
  blendMs: number;
}

export function parseSeq(file: Uint8Array): Seq {
  const d = unwrapZcmp(file);
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const count = v.getUint32(8, true);
  const hasBase = v.getUint32(12, true) === 1;
  const blendMs = v.getUint32(20, true);
  const names: string[] = [];
  let p = 24;
  const total = count + (hasBase ? 1 : 0);
  while (names.length < total && p < d.length) {
    let e = p;
    while (e < d.length && d[e] !== 0) e++;
    names.push(String.fromCharCode(...d.subarray(p, e)));
    p = e + 1;
  }
  p = (p + 3) & ~3; // the weights start on a 4-byte boundary
  const weights: number[] = [];
  for (let i = 0; i < total && p + 4 * (i + 1) <= d.length; i++) weights.push(v.getFloat32(p + 4 * i, true));
  while (weights.length < total) weights.push(1);
  const clips = names.slice(0, count);
  return { clips, weights: weights.slice(0, count), baseIdle: hasBase ? names[count] ?? null : null, blendMs };
}
