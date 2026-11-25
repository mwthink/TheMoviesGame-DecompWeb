import { gameHash } from "../assets/hash.ts";

/** A placed object in a saved game: a building, prop or the lot itself. Position is in game units (x, y on the ground, z up). */
export interface PlacedAsset {
  cls: string;
  id: number;
  /** Names the asset's ini, e.g. `facility/facility_gatehouse` or `ornament/p_hedge`. */
  source: string;
  position: [number, number, number];
  /** Rotation about the vertical axis in radians, counter-clockwise seen from above. */
  angle: number;
}

/** The ground paint (docs/SAVE_FORMAT.md, "Placement: coordinates, the 2-unit grid and the terrain"). */
export interface Landscape {
  /** Ground texture names, e.g. `Land_grass00`. */
  textures: string[];
  /** 256 x 256 vertices x 3 paint layers, index (x * 256 + y) * 3 + layer. Low nibble = texture index (0xF none), bits 4-5 = blend weight. */
  cells: Uint8Array;
  /** 8192 bytes: bit x * 256 + y set = a paved path cell. */
  path: Uint8Array;
}

/** The camera the game stored in the lot object: SL_CamPos (eye), SL_CamFoc (focus), SL_CamRot (angle, radians) and SL_CamZoo (zoom, 0 far .. 0.8 close). */
export interface SavedCamera {
  eye: [number, number, number];
  focus: [number, number, number];
  angle: number;
  zoom: number;
}

export interface Save {
  placed: PlacedAsset[];
  landscape: Landscape | null;
  /** From the CLot object; null if the save has none. */
  lotCamera: SavedCamera | null;
}

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

function find(hay: Uint8Array, needle: Uint8Array, from: number, to = hay.length): number {
  const first = needle[0]!;
  for (let i = hay.indexOf(first, from); i >= 0 && i + needle.length <= to; i = hay.indexOf(first, i + 1)) {
    let k = 1;
    while (k < needle.length && hay[i + k] === needle[k]) k++;
    if (k === needle.length) return i;
  }
  return -1;
}

/** `'#X'` records: tag (4 bytes) + value, separated by an optional newline. Same splitting as tools/jad_dump.py `split_fields`. */
function splitFields(d: Uint8Array, start: number, end: number): { tag: string; value: Uint8Array }[] {
  const marker = enc("#X");
  const starts: number[] = [];
  for (let i = find(d, marker, start, end); i >= 0; i = find(d, marker, i + 2, end)) starts.push(i);
  const out: { tag: string; value: Uint8Array }[] = [];
  for (let k = 0; k < starts.length; k++) {
    const a = starts[k]! + 2;
    let b = k + 1 < starts.length ? starts[k + 1]! : end;
    if (k + 1 < starts.length && d[b - 1] === 0x0a) b--; // the separator's newline
    while (b > a + 4 && d[b - 1] === 0x0a) b--; // rstrip(b"\n"), but never into the tag
    const tag = Array.from(d.subarray(a, a + 4), (x) => x.toString(16).padStart(2, "0")).join("");
    out.push({ tag, value: d.subarray(a + 4, b) });
  }
  return out;
}

function tagOf(name: string): string {
  const h = gameHash(name);
  return [h & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff, h >>> 24].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const PREFIX = [0x8a, 0xb3, 0x7c, 0x01, 0x04, 0x00, 0x00, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x0a];

/** Read the parts of a `.jad` saved game the world view needs. The container is described in docs/SAVE_FORMAT.md. */
export function parseSave(d: Uint8Array): Save {
  if (!PREFIX.every((b, i) => d[i] === b)) throw new Error("not a saved game (unexpected file prefix)");
  const objectsAt = find(d, enc("[OBJECTS]\n"), 0);
  if (objectsAt < 0) throw new Error("saved game has no [OBJECTS] section");
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);

  const tSrc = tagOf("SourcePath");
  const tPos = tagOf("POSITION");
  const tAng = tagOf("MyAngle");
  const placed: PlacedAsset[] = [];
  let landscapeBlob: Uint8Array | null = null;
  let lotCamera: SavedCamera | null = null;

  const open = enc("[OBJ]\n");
  const close = enc("\n[/OBJ]");
  let p = objectsAt;
  for (;;) {
    const a = find(d, open, p);
    if (a < 0) break;
    const bodyStart = a + open.length;
    const b = find(d, close, bodyStart);
    if (b < 0) break;
    p = b + close.length;

    const nameLen = v.getUint32(bodyStart + 4, true);
    let cls = "";
    for (let i = 0; i < nameLen; i++) cls += String.fromCharCode(d[bodyStart + 8 + i]!);
    cls = cls.replace(/^\.\?AV/, "").replace("@TM@@", "").replaceAll("@", ".");
    const id = v.getUint32(bodyStart + 8 + nameLen, true);
    const fields = splitFields(d, bodyStart + 12 + nameLen, b);

    if (cls === "TMLandscape") {
      for (const f of fields) if (!landscapeBlob || f.value.length > landscapeBlob.length) landscapeBlob = f.value;
      continue;
    }
    const first = new Map<string, Uint8Array>();
    for (const f of fields) if (!first.has(f.tag)) first.set(f.tag, f.value);
    if (cls === "CLot" && !lotCamera) lotCamera = readCamera(first);
    const src = first.get(tSrc);
    const pos = first.get(tPos);
    if (!src || !pos || pos.length < 12) continue;
    const sv = new DataView(src.buffer, src.byteOffset, src.byteLength);
    const n = src.length >= 4 ? sv.getUint32(0, true) : 0;
    let source = "?";
    if (n > 0 && n <= src.length - 4) {
      source = "";
      for (let i = 4; i < 4 + n && src[i] !== 0; i++) source += String.fromCharCode(src[i]!);
    }
    const pv = new DataView(pos.buffer, pos.byteOffset, pos.byteLength);
    const ang = first.get(tAng);
    placed.push({
      cls,
      id,
      source,
      position: [pv.getFloat32(0, true), pv.getFloat32(4, true), pv.getFloat32(8, true)],
      angle: ang && ang.length >= 4 ? new DataView(ang.buffer, ang.byteOffset, 4).getFloat32(0, true) : 0,
    });
  }
  return { placed, landscape: landscapeBlob ? parseLandscape(landscapeBlob) : null, lotCamera };
}

function readCamera(first: Map<string, Uint8Array>): SavedCamera | null {
  const f32 = (name: string, n: number): number[] | null => {
    const b = first.get(tagOf(name));
    if (!b || b.length < 4 * n) return null;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return Array.from({ length: n }, (_, i) => dv.getFloat32(4 * i, true));
  };
  const eye = f32("SL_CamPos", 3), focus = f32("SL_CamFoc", 3), rot = f32("SL_CamRot", 1), zoom = f32("SL_CamZoo", 1);
  if (!eye || !focus || !rot || !zoom) return null;
  return { eye: eye as [number, number, number], focus: focus as [number, number, number], angle: rot[0]!, zoom: zoom[0]! };
}

/** TMLandscape_ReadTerrainBlob: u32 length, u32 version, u32 texture count, 32-byte names, 65,793 cells x 3 bytes, then the 8 KB path bitmap. */
function parseLandscape(blob: Uint8Array): Landscape | null {
  if (blob.length < 245) return null;
  const v = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const n = v.getUint32(8, true);
  const textures: string[] = [];
  for (let i = 0; i < n; i++) {
    let s = "";
    for (let k = 0; k < 32 && blob[12 + 32 * i + k] !== 0; k++) s += String.fromCharCode(blob[12 + 32 * i + k]!);
    textures.push(s);
  }
  const base = 12 + 32 * n;
  const cells = new Uint8Array(256 * 256 * 3);
  for (let x = 0; x < 256; x++) {
    for (let y = 0; y < 256; y++) {
      const src = base + 3 * (x * 257 + y);
      const dst = (x * 256 + y) * 3;
      cells[dst] = blob[src]! & 0x3f;
      cells[dst + 1] = blob[src + 1]! & 0x3f;
      cells[dst + 2] = blob[src + 2]! & 0x3f;
    }
  }
  const pathAt = base + 3 * 65793;
  return { textures, cells, path: blob.slice(pathAt, pathAt + 8192) };
}
