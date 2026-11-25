// The parts of a .msh model the character code needs: render primitives (vertices, triangles, 4-weight skin records) and the skeleton. Layout:
// docs/MSH_FORMAT.md, tools/msh_dump.py. (web/src/formats/Msh.ts reads static models for the world view.)
//
// From LH_LoadMeshBinary (0x009DEB10); the skin record is the `f0 & 1` block (20 bytes per vertex: 4 f32 weights and 4 u8 bone indices), read by
// Mesh_GetPrimitiveSkinRecords (0x009D9D50).
import { unwrapZcmp } from "../../assets/inflate.ts";
import { identity, type RigidMatrix, type Vec3 } from "./RigidMatrix.ts";

const f32 = Math.fround;

export interface MeshVertex {
  pos: Vec3;
  normal: Vec3;
  uv: [number, number];
}

export interface SkinRecord {
  weight: [number, number, number, number];
  bone: [number, number, number, number];
}

export interface MeshPrimitive {
  material: number;
  vertices: MeshVertex[];
  triangles: [number, number, number][];
  /** empty when the primitive has no skin block */
  skin: SkinRecord[];
}

export interface MeshBone {
  name: string;
  parent: number;
  /** the bone's world bind pose: three axis rows plus the translation (row-vector convention) */
  bindWorld: RigidMatrix;
}

export interface SkinnedMesh {
  textures: string[];
  /** all nodes' primitives in file order */
  primitives: MeshPrimitive[];
  bones: MeshBone[];
}

const align4 = (p: number) => (p + 3) & ~3;

/** Parses a whole file (plain or `zcmp`); throws with the reason on failure. orig: 0x009DEB10 */
export function parseSkinnedMesh(fileBytes: Uint8Array): SkinnedMesh {
  const d = unwrapZcmp(fileBytes);
  if (d.length < 0x24) throw new Error("file too short");
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const u16 = (p: number) => v.getUint16(p, true);
  const u32 = (p: number) => v.getUint32(p, true);
  const f = (p: number) => v.getFloat32(p, true);
  const cstr = (p: number, n: number) => {
    const b = d.subarray(p, Math.min(p + n, d.length));
    const z = b.indexOf(0);
    return new TextDecoder("latin1").decode(z < 0 ? b : b.subarray(0, z));
  };
  const out: SkinnedMesh = { textures: [], primitives: [], bones: [] };
  if (u32(0) !== 10) throw new Error("unsupported mesh version");
  const ntex = u32(4), nmat = u32(8), nsub = u32(12);
  const flags = d.subarray(0x10, 0x18);
  const ctrl = flags[6]!;
  let pos = 0x18;
  const opt = [0, 0, 0];
  [2, 0x40, 0x80].forEach((bit, i) => {
    if (ctrl & bit) {
      opt[i] = u32(pos);
      pos += 4;
    }
  });
  const nNamed = opt[2]!;
  for (let i = 0; i < ntex; i++) out.textures.push(cstr(pos + 32 * i, 32));
  pos += 32 * ntex;
  for (let i = 0; i < nmat; i++) pos += d[pos + 0xe]! & 4 ? 0x18 : 0x14;
  // an aux polygon chunk (collision / footprint shapes): skipped, only its size matters
  const skipChunk = (why: string) => {
    if (pos + 8 > d.length) throw new Error(why);
    pos = align4(pos + 8 + 12 * u16(pos) + 6 * u16(pos + 4));
    if (pos > d.length) throw new Error(why);
  };
  // the aux polygon chunks, each present when its flag bit is set (the order of LH_LoadMeshBinary)
  for (const [byte, mask] of [[3, 0xff], [6, 0x10], [6, 0x08], [5, 0x04], [6, 0x04], [5, 0x02], [6, 0x01]] as const) if (flags[byte]! & mask) skipChunk("bad polygon chunk");
  for (let i = 0; i < nNamed; i++) {
    pos += 32;
    skipChunk("bad named part");
  }
  const fail = (why: string): never => { throw new Error(why); };
  for (let s = 0; s < nsub; s++) {
    if (pos + 0x34 > d.length) fail("bad render node");
    const nprim = d[pos]!;
    pos += d[pos + 3]! & 0x10 ? 0x38 : 0x34;
    for (let p = 0; p < nprim; p++) {
      if (pos + 16 > d.length) fail("bad render node");
      const prim: MeshPrimitive = { material: d[pos]!, vertices: [], triangles: [], skin: [] };
      const ntri = u32(pos + 4), nvert = u32(pos + 8), f0 = d[pos + 12]!, f1 = d[pos + 13]!;
      pos += 16;
      if (f0 & 0x10) pos += 12;
      const qb = new Array<number>(14).fill(0);
      if (f0 & 0x20) {
        if (pos + 56 > d.length) fail("bad render node");
        for (let i = 0; i < 14; i++) qb[i] = f(pos + 4 * i);
        pos += 56;
      }
      let extra = 0;
      if (f0 & 0x40) {
        extra = u32(pos);
        pos += 4;
      }
      if (pos + 6 * ntri > d.length) fail("bad render node");
      for (let i = 0; i < ntri; i++) prim.triangles.push([u16(pos + 6 * i), u16(pos + 6 * i + 2), u16(pos + 6 * i + 4)]);
      pos = align4(pos + 6 * ntri);
      if (f0 & 0x20) {
        // compact: 8 x u16 per vertex, dequantised with the bounds block
        if (pos + 16 * nvert > d.length) fail("bad render node");
        for (let i = 0; i < nvert; i++) {
          const t = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => u16(pos + 16 * i + 2 * k) / 65535);
          prim.vertices.push({
            pos: [0, 1, 2].map((k) => f32(qb[k]! + t[k]! * (qb[3 + k]! - qb[k]!))) as Vec3,
            normal: [0, 1, 2].map((k) => f32(2 * t[3 + k]! - 1)) as Vec3,
            uv: [f32(qb[6]! + t[6]! * (qb[8]! - qb[6]!)), f32(qb[7]! + t[7]! * (qb[9]! - qb[7]!))],
          });
        }
        pos += 16 * nvert;
        if (f1 & 1) pos += 4 * nvert; // a second UV set (lightmap)
      } else {
        // direct: 8 x f32 per vertex
        if (pos + 32 * nvert > d.length) fail("bad render node");
        for (let i = 0; i < nvert; i++) {
          const o = pos + 32 * i;
          prim.vertices.push({ pos: [f(o), f(o + 4), f(o + 8)], normal: [f(o + 12), f(o + 16), f(o + 20)], uv: [f(o + 24), f(o + 28)] });
        }
        pos += 32 * nvert;
        if (f1 & 1) pos += 8 * nvert;
      }
      pos = align4(pos);
      if (f0 & 1) {
        // skin: 4 f32 weights + 4 u8 bone indices per vertex
        if (pos + 20 * nvert > d.length) fail("bad render node");
        for (let i = 0; i < nvert; i++) {
          const o = pos + 20 * i;
          prim.skin.push({ weight: [f(o), f(o + 4), f(o + 8), f(o + 12)], bone: [d[o + 16]!, d[o + 17]!, d[o + 18]!, d[o + 19]!] });
        }
        pos += 20 * nvert;
      }
      pos += 8 * extra;
      if (pos > d.length) fail("bad render node");
      out.primitives.push(prim);
    }
  }
  // the skeleton block after the nodes: u32 ?, u32 n_bones, then n_bones x 84 bytes: 32-byte name, i32 parent, 12 f32 (three axis rows + translation)
  if (pos + 8 <= d.length) {
    const n = u32(pos + 4);
    if (n > 0 && n < 512 && pos + 8 + 84 * n <= d.length) {
      for (let i = 0; i < n; i++) {
        const o = pos + 8 + 84 * i;
        const m = identity();
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m.r[r]![c] = f(o + 36 + 4 * (3 * r + c));
        m.t = [f(o + 72), f(o + 76), f(o + 80)];
        out.bones.push({ name: cstr(o, 32), parent: v.getInt32(o + 32, true), bindWorld: m });
      }
    }
  }
  return out;
}
