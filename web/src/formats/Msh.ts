import { unwrapZcmp } from "../assets/inflate.ts";

/** One draw call's worth of geometry: triangles of one material, vertices already in model space (z up). */
export interface MshPrimitive {
  material: number;
  positions: Float32Array; // xyz per vertex
  normals: Float32Array; // xyz per vertex
  uv: Float32Array; // uv per vertex (v = 0 is the first row of the image)
  uv2: Float32Array | null; // lightmap uv per vertex, when the primitive has a second set
  indices: Uint16Array; // 3 per triangle
  flags: [number, number, number, number];
}

export interface MshMaterial {
  /** Texture indices: [0] diffuse, [1] second layer (reflection/overlay), [2] lightmap. 255 = none. */
  tex: [number, number, number, number];
  colour: number;
}

/** A flat polygon set: collision hulls, footprints and room floors (docs/MSH_FORMAT.md). */
export interface MshChunk {
  verts: Float32Array;
  tris: Uint16Array;
}

export interface Msh {
  textures: string[];
  materials: MshMaterial[];
  chunks: Record<string, MshChunk>;
  parts: { name: string; chunk: MshChunk }[];
  primitives: MshPrimitive[];
}

const CHUNK_SLOTS: [string, number, number][] = [
  ["flag13", 0x13, 0xff],
  ["b16_10", 0x16, 0x10],
  ["b16_08", 0x16, 0x08],
  ["b15_04", 0x15, 0x04],
  ["b16_04", 0x16, 0x04],
  ["b15_02", 0x15, 0x02],
  ["b16_01", 0x16, 0x01],
];

const align4 = (p: number) => (p + 3) & ~3;

function cstr(d: Uint8Array, pos: number, len: number): string {
  let s = "";
  for (let i = 0; i < len && d[pos + i] !== 0; i++) s += String.fromCharCode(d[pos + i]!);
  return s;
}

/**
 * Parse a version-10 .msh (port of tools/msh_dump.py `parse`, layout in docs/MSH_FORMAT.md). Skeletons, tag points and skin weights are
 * skipped: this reads static models only.
 */
export function parseMsh(file: Uint8Array): Msh {
  const d = unwrapZcmp(file);
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const version = v.getUint32(0, true);
  if (version !== 10) throw new Error(`unsupported mesh version ${version}`);
  const ntex = v.getUint32(4, true);
  const nmat = v.getUint32(8, true);
  const nsub = v.getUint32(12, true);
  const flags = d.subarray(0x10, 0x18);
  const ctrl = flags[6]!;
  let pos = 0x18;
  const opt: number[] = [];
  for (const bit of [2, 0x40, 0x80]) {
    if (ctrl & bit) {
      opt.push(v.getUint32(pos, true));
      pos += 4;
    } else opt.push(0);
  }
  const nNamed = opt[2]!;

  const textures: string[] = [];
  for (let i = 0; i < ntex; i++) textures.push(cstr(d, pos + 32 * i, 32));
  pos += 32 * ntex;

  const materials: MshMaterial[] = [];
  for (let i = 0; i < nmat; i++) {
    materials.push({
      tex: [d[pos]!, d[pos + 1]!, d[pos + 2]!, d[pos + 3]!],
      colour: v.getUint32(pos + 0x10, true),
    });
    pos += d[pos + 0xe]! & 4 ? 0x18 : 0x14;
  }

  const readChunk = (): MshChunk => {
    const nv = v.getUint16(pos, true);
    const nt = v.getUint16(pos + 4, true);
    pos += 8;
    const verts = new Float32Array(nv * 3);
    for (let i = 0; i < nv * 3; i++) verts[i] = v.getFloat32(pos + 4 * i, true);
    pos += 12 * nv;
    const tris = new Uint16Array(nt * 3);
    for (let i = 0; i < nt * 3; i++) tris[i] = v.getUint16(pos + 2 * i, true);
    pos = align4(pos + 6 * nt);
    return { verts, tris };
  };

  const chunks: Record<string, MshChunk> = {};
  for (const [name, off, mask] of CHUNK_SLOTS) {
    if (flags[off - 0x10]! & mask) chunks[name] = readChunk();
  }
  const parts: { name: string; chunk: MshChunk }[] = [];
  for (let i = 0; i < nNamed; i++) {
    const name = cstr(d, pos, 32);
    pos += 32;
    parts.push({ name, chunk: readChunk() });
  }

  const primitives: MshPrimitive[] = [];
  for (let n = 0; n < nsub; n++) {
    const nprim = d[pos]!;
    const extra = d[pos + 3]! & 0x10;
    pos += extra ? 0x38 : 0x34; // the node's 3x3 matrix + translation is ignored: vertices are already in model space
    for (let p = 0; p < nprim; p++) {
      const material = d[pos]!;
      const ntri = v.getUint32(pos + 4, true);
      const nvert = v.getUint32(pos + 8, true);
      const f0 = d[pos + 12]!;
      const f1 = d[pos + 13]!;
      const f2 = d[pos + 14]!;
      const f3 = d[pos + 15]!;
      pos += 16;
      if (f0 & 0x10) pos += 12;
      let qb: number[] | null = null;
      if (f0 & 0x20) {
        qb = [];
        for (let i = 0; i < 14; i++) qb.push(v.getFloat32(pos + 4 * i, true));
        pos += 56;
      }
      let skipRecords = 0;
      if (f0 & 0x40) {
        skipRecords = v.getUint32(pos, true);
        pos += 4;
      }
      const indices = new Uint16Array(ntri * 3);
      for (let i = 0; i < ntri * 3; i++) indices[i] = v.getUint16(pos + 2 * i, true);
      pos = align4(pos + 6 * ntri);

      const positions = new Float32Array(nvert * 3);
      const normals = new Float32Array(nvert * 3);
      const uv = new Float32Array(nvert * 2);
      let uv2: Float32Array | null = null;
      if (qb) {
        // compact: 8 x u16 per vertex, dequantised with the bounds block
        for (let i = 0; i < nvert; i++) {
          const o = pos + 16 * i;
          const t = (k: number) => v.getUint16(o + 2 * k, true) / 65535;
          positions[i * 3] = qb[0]! + t(0) * (qb[3]! - qb[0]!);
          positions[i * 3 + 1] = qb[1]! + t(1) * (qb[4]! - qb[1]!);
          positions[i * 3 + 2] = qb[2]! + t(2) * (qb[5]! - qb[2]!);
          normals[i * 3] = 2 * t(3) - 1;
          normals[i * 3 + 1] = 2 * t(4) - 1;
          normals[i * 3 + 2] = 2 * t(5) - 1;
          uv[i * 2] = qb[6]! + t(6) * (qb[8]! - qb[6]!);
          uv[i * 2 + 1] = qb[7]! + t(7) * (qb[9]! - qb[7]!);
        }
        pos += 16 * nvert;
        if (f1 & 1) {
          uv2 = new Float32Array(nvert * 2);
          for (let i = 0; i < nvert; i++) {
            const a = v.getUint16(pos + 4 * i, true) / 65535;
            const b = v.getUint16(pos + 4 * i + 2, true) / 65535;
            uv2[i * 2] = qb[10]! + a * (qb[12]! - qb[10]!);
            uv2[i * 2 + 1] = qb[11]! + b * (qb[13]! - qb[11]!);
          }
          pos += 4 * nvert;
        }
      } else {
        // direct: 8 x f32 per vertex (position, normal, uv)
        for (let i = 0; i < nvert; i++) {
          const o = pos + 32 * i;
          for (let k = 0; k < 3; k++) {
            positions[i * 3 + k] = v.getFloat32(o + 4 * k, true);
            normals[i * 3 + k] = v.getFloat32(o + 12 + 4 * k, true);
          }
          uv[i * 2] = v.getFloat32(o + 24, true);
          uv[i * 2 + 1] = v.getFloat32(o + 28, true);
        }
        pos += 32 * nvert;
        if (f1 & 1) {
          uv2 = new Float32Array(nvert * 2);
          for (let i = 0; i < nvert * 2; i++) uv2[i] = v.getFloat32(pos + 4 * i, true);
          pos += 8 * nvert;
        }
      }
      pos = align4(pos);
      if (f0 & 1) pos += 20 * nvert; // skin weights and bone indices: not used for static models
      pos += 8 * skipRecords;
      primitives.push({ material, positions, normals, uv, uv2, indices, flags: [f0, f1, f2, f3] });
    }
  }
  return { textures, materials, chunks, parts, primitives };
}
