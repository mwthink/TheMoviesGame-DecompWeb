import { unwrapZcmp } from "../assets/inflate.ts";

/** A costume file (`Data\chars\*.cos`, port of tools/cos_dump.py): which body mesh, texture layers and attached meshes make up a costume. */
export interface Cos {
  /** The body mesh, e.g. `cos_m_50s_1.msh`. */
  body: string;
  /** Texture layers (kind 1 records): file and slot name. */
  textures: { file: string; slot: string }[];
  /** Attached meshes (kind 2 records: hat, glasses, watch ...). */
  meshes: { file: string; slot: string }[];
}

const HEADER = 0xa8;
const RECORD = 0x78;

function cstr(d: Uint8Array, pos: number, len: number): string {
  let s = "";
  for (let i = 0; i < len && d[pos + i] !== 0; i++) s += String.fromCharCode(d[pos + i]!);
  return s;
}

/**
 * Parse a `.cos`. Only the common form (format byte 3, records of 0x78 bytes after a 0xa8 header) lists textures and meshes; the other forms (entourage and
 * extras) give just the body mesh name.
 */
export function parseCos(file: Uint8Array): Cos {
  const d = unwrapZcmp(file);
  const out: Cos = { body: cstr(d, 0x0c, 128), textures: [], meshes: [] };
  if (d[4] !== 3 || (d.length - HEADER) % RECORD !== 0) return out;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  for (let o = HEADER; o + RECORD <= d.length; o += RECORD) {
    const kind = v.getUint32(o + 0x28, true);
    const rec = { file: cstr(d, o, 32), slot: cstr(d, o + 0x30, 32) };
    if (kind === 1) out.textures.push(rec);
    else if (kind === 2) out.meshes.push(rec);
  }
  return out;
}
