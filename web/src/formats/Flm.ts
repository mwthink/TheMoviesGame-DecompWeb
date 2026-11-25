import { unwrapZcmp } from "../assets/inflate.ts";

/**
 * A `.flm` scene (docs/FLM_FORMAT.md, port of the structure walk in tools/FlmDump.py): a node graph of boxes that scripts what characters do. Only what the web app
 * needs so far is read: the string table and the objects as raw words, and `firstAnimation` to find what a character in a scene does first.
 */
export interface Flm {
  strings: string[];
  objects: FlmObject[];
  /** How many of the first strings name channels (the scene's named 0..1 variables, docs/FLM_FORMAT.md 5d). */
  channelCount: number;
  /** The file's per-channel extra word (present when the header's flag bit 1 is set): the channel's initial value as float bits. Null when the file has none. */
  channelDefaults: Int32Array | null;
}

export interface FlmObject {
  type: number;
  /** The object's words (the type and size words included): `words[2]` is its id. */
  words: Int32Array;
}

/** Object types (FLM_FORMAT.md). */
export const FlmType = { Box: 0, AnimBox: 1, MoveToBox: 2, ChoiceBox: 3, SettingsBox: 4, CObject: 5, Character: 6, CamBox: 7, CCamera: 8, CSettingsBox2: 9 } as const;

export function parseFlm(file: Uint8Array): Flm {
  const d = unwrapZcmp(file);
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const i32 = (p: number) => v.getInt32(p, true);
  const sbSize = i32(8); // h[2]
  const A = d[0x2c]!, B = d[0x2d]!, strCount = d[0x2e]!, chanCount = d[0x2f]!;
  const u32 = v.getUint16(0x32, true);
  const c34 = d[0x34]!, flags = d[0x35]!, c36 = d[0x36]!, c37 = d[0x37]!;
  let p = 0x3c + 4 * c37 + (A + B) * 4;
  const sb = p;
  const strings: string[] = [];
  for (let i = 0; i < strCount; i++) {
    const o = sb + i32(sb + 4 * i);
    let e = o;
    while (e < d.length && d[e] !== 0) e++;
    strings.push(String.fromCharCode(...d.subarray(o, e)));
  }
  p = sb + sbSize + 8 * c34;
  for (let i = 0; i < chanCount; i++) p += 4 + 4 * i32(p);
  let channelDefaults: Int32Array | null = null;
  if (flags & 2) {
    channelDefaults = new Int32Array(chanCount);
    for (let i = 0; i < chanCount; i++) channelDefaults[i] = i32(p + 4 * i);
    p += 4 * chanCount;
  }
  const objects: FlmObject[] = [];
  for (let i = 0; i < u32 + c36 && p + 8 <= d.length; i++) {
    const type = i32(p), size = i32(p + 4);
    if (size < 8 || p + size > d.length) break;
    const words = new Int32Array(size / 4);
    for (let k = 0; k < words.length; k++) words[k] = i32(p + 4 * k);
    objects.push({ type, words });
    p += size;
  }
  return { strings, objects, channelCount: chanCount, channelDefaults };
}

/** Clip names that move a character about rather than hold a pose (walking, running, turning on the spot), plus the hiring celebration (`hired_*`, played at the moment of hiring, not by someone waiting in the hire room); a standing person is not shown in these. */
const LOCOMOTION = /^(walk|run|jog|turn_|stand_rot|sneak|crawl|hired_)/i;

/**
 * What the first character of a scene does first: the first animation box reachable from its start box that holds a pose rather than moves the
 * character about. Returns the animation file named there (`staff_idle.seq`, `idle_male.anm`, `scriptwriter_sit_2_write.anm`) and the facing the scene gives the
 * character, or null when the scene has no such character or box.
 *
 * Reachability: a plain box (type 0) continues at word 15; for the other box types the link words were not decoded (docs/FLM_FORMAT.md), so every word of
 * theirs that equals another object's id counts as a link, tried in word order, breadth first. [guess] This finds the opening pose in the scenes
 * checked (pre-production crew, script office, costume research) but is not the game's choreography: it does not know which stage of a long scene a saved
 * person is at. The facing is the character's trailer word 19, a float; in the pre-production crew scene it equals the saved `MyAngle` of the crew member in one Quick Start save (-1.53037) who had not yet moved from it; in another save the same person faces differently.
 */
export function firstAnimation(flm: Flm): { name: string; startAngle: number } | null {
  const byId = new Map<number, FlmObject>();
  for (const o of flm.objects) byId.set(o.words[2]!, o);
  const character = flm.objects.find((o) => o.type === FlmType.Character);
  if (!character) return null;
  const angleBits = new Int32Array([character.words[19] ?? 0]);
  const startAngle = new Float32Array(angleBits.buffer)[0]!;
  const start = byId.get(character.words[5]!);
  if (!start) return null;
  const seen = new Set<FlmObject>([start]);
  const queue: FlmObject[] = [start];
  for (let q = 0; q < queue.length && q < 400; q++) {
    const at = queue[q]!;
    if (at.type === FlmType.AnimBox) {
      const name = flm.strings[at.words[15]!];
      if (name && !LOCOMOTION.test(name)) return { name, startAngle };
    }
    const links: number[] = [];
    if (at.type === FlmType.Box) links.push(at.words[15]!);
    else for (let i = 3; i < at.words.length; i++) if (byId.has(at.words[i]!) && at.words[i] !== at.words[2]) links.push(at.words[i]!);
    for (const id of links) {
      const next = byId.get(id);
      if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return null;
}
