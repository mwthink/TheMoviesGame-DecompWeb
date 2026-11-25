import { unwrapZcmp } from "../assets/inflate.ts";

/**
 * A version-12 `.anm` bone animation (port of tools/anm_dump.py `parse`; layout in docs/ANM_FORMAT.md).
 * Rotations are kept as Euler angles and translations as numbers, one triple per bone (channel) per frame, so a pose between two frames is a plain blend.
 */
export interface Anm {
  nFrames: number;
  nChannels: number;
  /** Parent channel of each channel, -1 for the root. */
  parents: Int16Array;
  /** The set header's flag byte (bit 0: translation scale present, bit 1: the 4th header float is present and the clip is sampled every 3rd frame, see `anmDurationMs`). */
  flags: number;
  /** Euler angles (x, y, z in radians) per frame and channel: index (frame * nChannels + channel) * 3. */
  angles: Float32Array;
  /** Translation (parent frame) per frame and channel, same indexing. */
  translations: Float32Array;
}

const align4 = (p: number) => (p + 3) & ~3;

/** One run-length-coded array of `n` u16 values; returns the values and the position after them. */
function readRle(v: DataView, pos: number, n: number): { values: Uint16Array; pos: number } {
  const mask = v.getUint16(pos, true);
  pos += 2;
  const out = new Uint16Array(n);
  let have = 0;
  while (have < n) {
    const w = v.getUint16(pos, true);
    if ((w & mask) === 0) {
      out[have++] = w; // a literal value
      pos += 2;
    } else {
      // a run: the count is packed into the word around the mask bit, the value is the next u16
      const count = ((((w - mask) >> 1) & 0xffff) & ((~(mask - 1) >> 1) & 0xffff)) | ((mask - 1) & w);
      const value = v.getUint16(pos + 2, true);
      for (let i = 0; i < count && have < n; i++) out[have++] = value;
      pos += 4;
    }
  }
  return { values: out, pos };
}

/** Parse a `.anm` file (zcmp-wrapped or raw). */
export function parseAnm(file: Uint8Array): Anm {
  const d = unwrapZcmp(file);
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const version = v.getUint32(0, true);
  if (version < 12) throw new Error(`unsupported .anm version ${version}`);
  let pos = 0x3c;
  const nFrames = v.getUint32(pos, true) & 0x7fff;
  const nChannels = v.getUint16(pos + 4, true);
  const flags = d[pos + 7]!;
  pos += flags & 2 ? 0x1c : 0x18;
  let scale = 10;
  if (flags & 1) {
    scale = v.getFloat32(pos, true);
    pos += 4;
  }
  const parents = new Int16Array(nChannels);
  for (let i = 0; i < nChannels; i++) parents[i] = d[pos + i] === 0xff ? -1 : d[pos + i]!;
  pos = align4(pos + nChannels);

  const angles = new Float32Array(nFrames * nChannels * 3);
  const translations = new Float32Array(nFrames * nChannels * 3);
  for (let c = 0; c < nChannels; c++) {
    const constantTranslation = (d[pos]! & 1) !== 0;
    pos += 4;
    for (let k = 0; k < 3; k++) {
      const r = readRle(v, pos, nFrames);
      pos = r.pos;
      for (let t = 0; t < nFrames; t++) angles[(t * nChannels + c) * 3 + k] = ((r.values[t]! - 0.5) / 32768 - 1) * Math.PI;
    }
    pos = align4(pos);
    if (constantTranslation) {
      for (let k = 0; k < 3; k++) {
        // the game stores the constant as a float and re-quantises it (Anim_BuildTranslationTable): the same value up to rounding
        const value = v.getFloat32(pos + 4 * k, true);
        for (let t = 0; t < nFrames; t++) translations[(t * nChannels + c) * 3 + k] = value;
      }
      pos += 12;
    } else {
      for (let k = 0; k < 3; k++) {
        const r = readRle(v, pos, nFrames);
        pos = r.pos;
        for (let t = 0; t < nFrames; t++) translations[(t * nChannels + c) * 3 + k] = (r.values[t]! / 32767 - 1) * scale;
      }
      pos = align4(pos);
    }
  }
  return { nFrames, nChannels, parents, flags, angles, translations };
}

/**
 * The clip's length in milliseconds. orig: 0x0059EE40 `Anim_GetLengthMs` (used by `AnimInstance_SetFrame` and `Anim_GetFrameAtTime`):
 * 100 ms per stored frame minus one, but when flag bit 1 is set only every third frame counts, so (n - 1) / 3 + 1 frames. The flag animations
 * (55 frames, flags 3) therefore last 1800 ms, i.e. 54 intervals at 30 per second. Never less than 100.
 */
export function anmDurationMs(a: Pick<Anm, "nFrames" | "flags">): number {
  const frames = a.flags & 2 ? Math.trunc((a.nFrames - 1) / 3) + 1 : a.nFrames;
  return Math.max(100, frames * 100 - 100);
}

/**
 * The fractional frame to sample at `timeMs` into the clip. orig: 0x00985EB0 `Anim_GetFrameAtTime`: `(nFrames - 1) * t / duration`; times past the end wrap
 * (the clips loop; the last frame equals the first).
 */
export function anmFramePosition(a: Pick<Anm, "nFrames" | "flags">, timeMs: number): number {
  const dur = anmDurationMs(a);
  const t = ((timeMs % dur) + dur) % dur;
  return ((a.nFrames - 1) * t) / dur;
}
