// The .hd head morph files (Data\Heads\*.hd, and the star.hd a StarMaker star saves). Layout: docs/CHARACTERS.md, tools/hd_dump.py.
//
//   0x00  u32 4, u32 hash, u32 hash
//   0x0c  texture name, NUL padded, 32 bytes (a star.hd also has a second texture at 0x2c and the head file names at 0x4c / 0x6c)
//   0x94  three arrays of 996 vertices x 6 floats (position, normal): A = the base shape, B = the weight morph, C = the age morph
//
// vertex = A + weight * B + age * C; two heads are mixed with (1 - mix) / mix; normals are summed alike and renormalised.
// From CharacterHead_ApplyHdMorph (0x009DB5F0); the array roles are confirmed by StarMaker's star.hd writer (docs/STARMAKER.md 10).

const f32 = Math.fround;

/** 760 face + 58 eyes + 178 mouth interior: the vertices of generic_head.msh / generic_facialskin.msh. */
export const HEAD_VERTEX_COUNT = 996;
const HEADER_SIZE = 0x94;
const ARRAY_FLOATS = HEAD_VERTEX_COUNT * 6;

export interface HeadFile {
  /** 0x0c texture 0, 0x2c texture 1, 0x4c head 0, 0x6c head 1 (empty where absent) */
  names: [string, string, string, string];
  /** 996 x (x, y, z, nx, ny, nz) each */
  a: Float32Array;
  b: Float32Array;
  c: Float32Array;
  /** the first 0x94 bytes as read, for writing the file back */
  header: Uint8Array;
}

export function parseHead(bytes: Uint8Array): HeadFile {
  if (bytes.length < HEADER_SIZE + 3 * ARRAY_FLOATS * 4) throw new Error("file too short for a .hd");
  const name = (o: number) => {
    const s = bytes.subarray(o, o + 32);
    const z = s.indexOf(0);
    return new TextDecoder("latin1").decode(z < 0 ? s : s.subarray(0, z));
  };
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const arr = (k: number) => {
    const out = new Float32Array(ARRAY_FLOATS);
    for (let i = 0; i < ARRAY_FLOATS; i++) out[i] = v.getFloat32(HEADER_SIZE + (k * ARRAY_FLOATS + i) * 4, true);
    return out;
  };
  return { names: [name(0x0c), name(0x2c), name(0x4c), name(0x6c)], a: arr(0), b: arr(1), c: arr(2), header: bytes.slice(0, HEADER_SIZE) };
}

/** The three arrays written back after the header words and names. */
export function serializeHead(h: HeadFile): Uint8Array {
  const out = new Uint8Array(HEADER_SIZE + 3 * ARRAY_FLOATS * 4);
  out.set(h.header.subarray(0, HEADER_SIZE));
  const v = new DataView(out.buffer);
  [h.a, h.b, h.c].forEach((arr, k) => arr.forEach((x, i) => v.setFloat32(HEADER_SIZE + (k * ARRAY_FLOATS + i) * 4, x, true)));
  return out;
}

/** second may be null (then mix is ignored); weight and age are the morph amounts 0..1. Returns 996 x 6 floats, normals renormalised. orig: 0x009DB5F0 */
export function applyHdMorph(first: HeadFile, second: HeadFile | null, mix: number, weight: number, age: number): Float32Array {
  const out = new Float32Array(ARRAY_FLOATS);
  for (let i = 0; i < HEAD_VERTEX_COUNT; i++) {
    const x: number[] = [];
    for (let k = 0; k < 6; k++) {
      const j = 6 * i + k;
      let s = f32(f32(first.a[j]! + f32(weight * first.b[j]!)) + f32(age * first.c[j]!));
      if (second) s = f32(f32(f32(1 - mix) * s) + f32(mix * f32(f32(second.a[j]! + f32(weight * second.b[j]!)) + f32(age * second.c[j]!))));
      x.push(s);
    }
    const len = f32(Math.sqrt(x[3]! * x[3]! + x[4]! * x[4]! + x[5]! * x[5]!));
    for (let k = 0; k < 3; k++) {
      out[6 * i + k] = x[k]!;
      out[6 * i + 3 + k] = len > 0 ? x[3 + k]! / len : x[3 + k]!;
    }
  }
  return out;
}
