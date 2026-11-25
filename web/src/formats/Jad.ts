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

/** The saved game's header: the in-game date and the player studio's cash (docs/SAVE_FORMAT.md, "Header"). */
export interface SaveHeader {
  /** The in-game date: days at 365 per year, the fraction is the time of day (715563.875 = June 1960). */
  date: number;
  /** The player studio's cash. */
  cash: number;
}

/** A person employed by the player's studio: a `CStaff` (crew) or a `CStar` (docs/SAVE_FORMAT.md). */
export interface SavedStaff {
  id: number;
  /** The object class: `CStaff` for crew, `CStar` for actors. */
  cls: "CStaff" | "CStar";
  name: string;
  /** What the staff slot group they belong to is for (`CSubFacility.StaffCareer`: `staff`, `wannabe`, `scientist`, `writer`, ...); "" when unknown. */
  career: string;
  /** The day they were hired (same day count as the date); 0 when absent. */
  hired: number;
}

/** The names a saved `CCostume` blob mentions (it has no tagged fields; the strings are found by scanning, as `tools/save_cast.py` does). */
export interface SavedCostume {
  /** The costume's own name (the first string), e.g. `f_cheerleader_1`. */
  name: string;
  /** The `.cos` file, e.g. `f_cheerleader_1.cos`; "" when the blob names none. */
  cos: string;
  /** The hair mesh (`hair_20s_f12.msh`); "" when none. */
  hair: string;
}

/** A person standing in the world: a staff member, a star or a wannabe, with where and how (docs/PEOPLE.md). */
export interface SavedPerson {
  id: number;
  cls: "CStaff" | "CStar" | "CWannabe";
  name: string;
  /** World position (x, y on the ground, z up). Saved people have POSITION in world space even when they are inside a building. */
  position: [number, number, number];
  /** Facing about the vertical axis, radians, counter-clockwise seen from above (same as placed assets). */
  angle: number;
  employer: number;
  costume: SavedCostume | null;
  /** `Head[0]`, `Head[1]` and `HeadMix` of a star or wannabe; "" when the person has no saved head (crew have none). */
  head: string;
  head2: string;
  headMix: number;
  weight: number;
  /** Birth day (game day count); 0 when absent. */
  birth: number;
  /** The room they are in (`InRoomName`, e.g. `room_preprod_crew`; "" or `room_` when none) and which scene variant they stand in (`InRoomIdx`). */
  room: string;
  roomIndex: number;
}

export interface Save {
  /** Everyone with a body in the world (staff, stars, wannabes), also those who are not the player's. */
  people: SavedPerson[];
  header: SaveHeader | null;
  /** Everyone the player's studio employs, in the order of the save. */
  staff: SavedStaff[];
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
  const staffRaw: { id: number; cls: "CStaff" | "CStar"; name: string; employer: number; subFacility: number; hired: number }[] = [];
  const careers = new Map<number, string>(); // CSubFacility id -> StaffCareer
  let playerStudio = -1;
  const costumes = new Map<number, SavedCostume>();
  const peopleRaw: { id: number; cls: SavedPerson["cls"]; first: Map<string, Uint8Array> }[] = [];
  const tName = tagOf("name"), tEmployer = tagOf("PEmployer"), tSub = tagOf("PSubFacility"), tHired = tagOf("Hired"), tCareer = tagOf("StaffCareer");

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
    if (cls === "CCostume") costumes.set(id, readCostume(d.subarray(bodyStart + 12 + nameLen, b)));
    if (cls === "CStaff" || cls === "CStar" || cls === "CWannabe") peopleRaw.push({ id, cls, first });
    if (cls === "CStudioPlayer") playerStudio = id;
    else if (cls === "CSubFacility") careers.set(id, readNarrow(first.get(tCareer)));
    else if (cls === "CStaff" || cls === "CStar") {
      staffRaw.push({ id, cls, name: readWide(first.get(tName)), employer: readU32(first.get(tEmployer)), subFacility: readU32(first.get(tSub)), hired: readF32(first.get(tHired)) });
    }
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
  const staff: SavedStaff[] = staffRaw
    .filter((r) => r.employer === playerStudio && playerStudio >= 0)
    .map((r) => ({ id: r.id, cls: r.cls, name: r.name, career: careers.get(r.subFacility) ?? "", hired: r.hired }));
  const tPos2 = tPos, tAng2 = tAng, tCostume = tagOf("PCurrentCostume"), tH0 = tagOf("Head[0]"), tH1 = tagOf("Head[1]"), tMix = tagOf("HeadMix"), tW = tagOf("WEIGHT"), tBirth = tagOf("Birth"), tRoom = tagOf("InRoomName"), tRoomIdx = tagOf("InRoomIdx");
  const people: SavedPerson[] = peopleRaw.map(({ id, cls, first }) => {
    const pos = first.get(tPos2);
    const pv = pos && pos.length >= 12 ? view(pos) : null;
    return {
      id, cls,
      name: readWide(first.get(tName)),
      position: pv ? [pv.getFloat32(0, true), pv.getFloat32(4, true), pv.getFloat32(8, true)] : [0, 0, 0],
      angle: readF32(first.get(tAng2)),
      employer: readU32(first.get(tEmployer)),
      costume: costumes.get(readU32(first.get(tCostume))) ?? null,
      head: readNarrow(first.get(tH0)), head2: readNarrow(first.get(tH1)), headMix: readF32(first.get(tMix)),
      weight: readF32(first.get(tW)), birth: readF32(first.get(tBirth)),
      room: readNarrow(first.get(tRoom)), roomIndex: readU32(first.get(tRoomIdx)),
    };
  });
  return { people, header: readHeader(d, v), staff, placed, landscape: landscapeBlob ? parseLandscape(landscapeBlob) : null, lotCamera };
}

/** The header's two leading floats: the date, then the cash. */
function readHeader(d: Uint8Array, v: DataView): SaveHeader | null {
  const at = find(d, enc("[HEADER]\n"), 0);
  if (at < 0 || at + 17 > d.length) return null;
  return { date: v.getFloat32(at + 9, true), cash: v.getFloat32(at + 13, true) };
}

/** The printable strings of a costume blob; the first is the name, then the `.cos` file and the hair mesh by their endings. */
function readCostume(body: Uint8Array): SavedCostume {
  const strings: string[] = [];
  let cur = "";
  for (const byte of body) {
    if (byte >= 0x20 && byte < 0x7f) cur += String.fromCharCode(byte);
    else { if (cur.length >= 4) strings.push(cur); cur = ""; }
  }
  if (cur.length >= 4) strings.push(cur);
  const out: SavedCostume = { name: strings[0] ?? "", cos: "", hair: "" };
  for (const s of strings) {
    const low = s.toLowerCase();
    if (low.endsWith(".cos")) out.cos = s;
    else if (low.endsWith(".msh") && low.includes("hair")) out.hair = s;
  }
  return out;
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
function readU32(b: Uint8Array | undefined): number { return b && b.length >= 4 ? view(b).getUint32(0, true) : 0; }
function readF32(b: Uint8Array | undefined): number { return b && b.length >= 4 ? view(b).getFloat32(0, true) : 0; }
/** A u32 byte length then ASCII. */
function readNarrow(b: Uint8Array | undefined): string {
  if (!b || b.length < 4) return "";
  const n = Math.min(view(b).getUint32(0, true), b.length - 4);
  let s = "";
  for (let i = 0; i < n && b[4 + i] !== 0; i++) s += String.fromCharCode(b[4 + i]!);
  return s;
}
/** A u32 byte length then UTF-16LE including the terminator. */
function readWide(b: Uint8Array | undefined): string {
  if (!b || b.length < 4) return "";
  const n = Math.min(view(b).getUint32(0, true), b.length - 4);
  let s = "";
  for (let i = 0; i + 1 < n; i += 2) {
    const c = b[4 + i]! | (b[5 + i]! << 8);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
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

/** A `data\\savedefaults\\<name>.lnd` file: the same blob as a save's terrain without its leading length word (docs/SAVE_FORMAT.md, "Start data"). */
export function parseLandscapeFile(lnd: Uint8Array): Landscape | null {
  const blob = new Uint8Array(lnd.length + 4);
  blob.set(lnd, 4);
  return parseLandscape(blob);
}

/** TMLandscape_ReadTerrainBlob: u32 length, u32 version, u32 texture count, 32-byte names, 65,793 cells x 3 bytes, then the 8 KB path bitmap. */
export function parseLandscape(blob: Uint8Array): Landscape | null {
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
