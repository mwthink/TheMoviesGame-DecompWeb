// The Movies .anm animations (version 12). Format notes: docs/ANM_FORMAT.md, tools/anm_dump.py.
//
// From Anim_ReadHeader (0x00984AD0), Anim_ReadSetHeader (0x00984B40), Anim_ReadTrackSet (0x009859C0), Anim_ReadChannel (0x00A4E030), Anim_ExpandChannel
// (0x00A4DB20), Anim_BuildTranslationTable (0x009852C0) and the Euler-to-matrix conversion (0x009AB3F0). Only what the face rig needs is kept: per
// channel and frame a rotation and a translation, local to the channel's parent.
import { unwrapZcmp } from "../../assets/inflate.ts";
import { identity, type RigidMatrix } from "./RigidMatrix.ts";

export interface AnmFile {
  version: number;
  frameCount: number;
  channelCount: number;
  translationScale: number;
  /** per channel, -1 = no parent in this animation */
  parents: number[];
  /** frames[t][channel] */
  frames: RigidMatrix[][];
}

const align4 = (p: number) => (p + 3) & ~3;

/** Rows are the axes: [cy*cz, cy*sz, -sy], [sx*sy*cz - cx*sz, cx*cz + sx*sy*sz, sx*cy], [sx*sz + sy*cx*cz, sy*cx*sz - sx*cz, cx*cy]. orig: 0x009AB3F0 */
function eulerRows(ax: number, ay: number, az: number): RigidMatrix["r"] {
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  return [
    [cy * cz, cy * sz, -sy],
    [sx * sy * cz - cx * sz, cx * cz + sx * sy * sz, sx * cy],
    [sx * sz + sy * cx * cz, sy * cx * sz - sx * cz, cx * cy],
  ];
}

/** Parses a whole file (plain or `zcmp`); throws with the reason on failure. orig: 0x00984AD0 (and the functions listed above) */
export function parseAnm(fileBytes: Uint8Array): AnmFile {
  const d = unwrapZcmp(fileBytes);
  if (d.length < 0x60) throw new Error("file too short");
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const need = (n: number, why: string) => { if (n > d.length) throw new Error(why); };
  const version = v.getUint32(0, true);
  if (version < 12) throw new Error("unsupported .anm version");
  let pos = 0x3c;
  const nframes = v.getUint32(pos, true);
  const channelCount = v.getUint16(pos + 4, true);
  const setFlags = d[pos + 7]!;
  pos += setFlags & 2 ? 0x1c : 0x18;
  let translationScale = 10;
  if (setFlags & 1) {
    translationScale = v.getFloat32(pos, true);
    pos += 4;
  }
  const frameCount = nframes & 0x7fff;
  need(pos + channelCount, "truncated");
  const parents = Array.from(d.subarray(pos, pos + channelCount), (b) => (b === 0xff ? -1 : b));
  pos = align4(pos + channelCount);

  // one run-length array of n u16 values: a mask word, then words; a word without the mask bit is a literal, with it a run of the next word
  const readRle = (n: number, why: string): number[] => {
    const out: number[] = [];
    need(pos + 2, why);
    const mask = v.getUint16(pos, true);
    pos += 2;
    while (out.length < n) {
      need(pos + 2, why);
      const w = v.getUint16(pos, true);
      if ((w & mask) === 0) {
        out.push(w);
        pos += 2;
      } else {
        need(pos + 4, why);
        const a = ((w - mask) >>> 1) & 0xffff;
        const b = (~(mask - 1) >>> 1) & 0xffff;
        const count = (a & b) | ((mask - 1) & w);
        const value = v.getUint16(pos + 2, true);
        for (let i = 0; i < count; i++) out.push(value);
        pos += 4;
      }
    }
    if (out.length !== n) throw new Error(why);
    return out;
  };

  const chans: { rot: number[][]; tr: number[][] }[] = [];
  for (let c = 0; c < channelCount; c++) {
    need(pos + 4, "truncated channel");
    const flags = d[pos]!;
    pos += 4;
    const rot = [0, 1, 2].map(() => readRle(frameCount, "rotation RLE overran"));
    pos = align4(pos);
    let tr: number[][];
    if (flags & 1) {
      // a constant translation: Anim_BuildTranslationTable stores round(((1 / scale) * c + 1) * 32767)
      need(pos + 12, "truncated constant translation");
      tr = [0, 1, 2].map((k) => new Array<number>(frameCount).fill(Math.floor(((1 / translationScale) * v.getFloat32(pos + 4 * k, true) + 1) * 32767 + 0.5) & 0xffff));
      pos += 12;
    } else {
      tr = [0, 1, 2].map(() => readRle(frameCount, "translation RLE overran"));
      pos = align4(pos);
    }
    chans.push({ rot, tr });
  }
  const frames: RigidMatrix[][] = [];
  for (let t = 0; t < frameCount; t++) {
    frames.push(chans.map((ch) => {
      const m = identity();
      const ang = ch.rot.map((r) => ((r[t]! - 0.5) / 32768 - 1) * Math.PI);
      m.r = eulerRows(ang[0]!, ang[1]!, ang[2]!);
      m.t = [0, 1, 2].map((k) => (ch.tr[k]![t]! / 32767 - 1) * translationScale) as RigidMatrix["t"];
      return m;
    }));
  }
  return { version, frameCount, channelCount, translationScale, parents, frames };
}
