// The StarMaker star file (Documents\The Movies\StarMaker\<yyyy_mm_dd_hh_mm_ss>\info.sm). Layout: docs/STARMAKER.md section 6; every field was matched to
// a control with saved stars and to the editor's load code (StarMaker_ApplyInfoSmToUI 0x004043EB) and save code (StarMaker_BuildInfoSm 0x00407D7F,
// StarMaker_ReadInfoSm 0x00427180).
//
//   0x00 u32 version (2)     0x04 u32 file size       0x08 u32 id (a checksum of the data; the algorithm is not known, kept as read)
//   0x0c u32 gender (1 male, 0 female)
//   0x10 14 x f32 attributes: looks, trimness, chest/breast, action, comedy, horror, romance, sci-fi, stress, boredom, drink, food, mood upper, mood lower
//        (the order of the last six is a guess; looks and trimness are confirmed)
//   0x48 char[32] first head file     0x68 char[32] second head file (empty if none)     0x88 char[32] hair file
//   0xa8 f32 head shape blend slider  0xac f32 skin tone blend slider  0xb0 u32 eye colour  0xb4 f32 age slider  0xb8 u32 hair colour
//   0xbc..0xcc 5 x u32 makeup choices: eyebrows, eye makeup, eye makeup colour, facial hair, lipstick
//   0xd0 43 x f32 face sliders (0.5 neutral)     0x17c u32 0 (a pointer slot filled at load time)     0x180 UTF-16 name, NUL terminated

const f32 = Math.fround;

export interface StarInfo {
  version: number;
  id: number;
  gender: number;
  attributes: number[];
  head0: string;
  head1: string;
  hair: string;
  headBlend: number;
  skinBlend: number;
  eyeColour: number;
  ageSlider: number;
  hairColour: number;
  eyebrow: number;
  eyeMakeup: number;
  makeupColour: number;
  beard: number;
  lipstick: number;
  sliders: number[];
  name: string;
}

export const Attribute = { Looks: 0, Trimness: 1, Chest: 2 } as const;
export const INFO_SM_VERSION = 2;
/** size = 0x182 + 2 * name length (the name's terminator is included) */
export const INFO_SM_FIXED_SIZE = 0x182;

export function defaultStarInfo(): StarInfo {
  return {
    version: 2, id: 0, gender: 1, attributes: new Array(14).fill(0), head0: "", head1: "", hair: "", headBlend: 0.5, skinBlend: 0.5, eyeColour: 0,
    ageSlider: 0, hairColour: 0, eyebrow: 1, eyeMakeup: 0, makeupColour: 1, beard: 0, lipstick: 0, sliders: new Array(43).fill(0), name: "",
  };
}

/** Checks the version is 2; throws otherwise. orig: StarMaker_ReadInfoSm 0x00427180 */
export function parseInfoSm(bytes: Uint8Array): StarInfo {
  if (bytes.length < INFO_SM_FIXED_SIZE) throw new Error("file too short");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (p: number) => v.getUint32(p, true);
  const f = (p: number) => v.getFloat32(p, true);
  if (u32(0) !== INFO_SM_VERSION) throw new Error("unsupported version");
  const cstr = (p: number) => {
    const s = bytes.subarray(p, p + 32);
    const z = s.indexOf(0);
    return new TextDecoder("latin1").decode(z < 0 ? s : s.subarray(0, z));
  };
  let name = "";
  for (let p = 0x180; p + 1 < bytes.length; p += 2) {
    const c = v.getUint16(p, true);
    if (c === 0) break;
    name += String.fromCharCode(c);
  }
  return {
    version: u32(0), id: u32(8), gender: u32(0x0c), attributes: Array.from({ length: 14 }, (_, i) => f(0x10 + 4 * i)),
    head0: cstr(0x48), head1: cstr(0x68), hair: cstr(0x88), headBlend: f(0xa8), skinBlend: f(0xac), eyeColour: u32(0xb0), ageSlider: f(0xb4),
    hairColour: u32(0xb8), eyebrow: u32(0xbc), eyeMakeup: u32(0xc0), makeupColour: u32(0xc4), beard: u32(0xc8), lipstick: u32(0xcc),
    sliders: Array.from({ length: 43 }, (_, i) => f(0xd0 + 4 * i)), name,
  };
}

/** orig: StarMaker_BuildInfoSm 0x00407D7F */
export function buildInfoSm(info: StarInfo): Uint8Array {
  const size = INFO_SM_FIXED_SIZE + 2 * info.name.length;
  const d = new Uint8Array(size);
  const v = new DataView(d.buffer);
  const u32 = (p: number, x: number) => v.setUint32(p, x >>> 0, true);
  const f = (p: number, x: number) => v.setFloat32(p, x, true);
  const str = (p: number, s: string) => {
    for (let i = 0; i < Math.min(s.length, 31); i++) d[p + i] = s.charCodeAt(i) & 0xff;
  };
  u32(0, info.version);
  u32(4, size);
  u32(8, info.id);
  u32(0x0c, info.gender);
  info.attributes.forEach((x, i) => f(0x10 + 4 * i, x));
  str(0x48, info.head0);
  str(0x68, info.head1);
  str(0x88, info.hair);
  f(0xa8, info.headBlend);
  f(0xac, info.skinBlend);
  u32(0xb0, info.eyeColour);
  f(0xb4, info.ageSlider);
  u32(0xb8, info.hairColour);
  u32(0xbc, info.eyebrow);
  u32(0xc0, info.eyeMakeup);
  u32(0xc4, info.makeupColour);
  u32(0xc8, info.beard);
  u32(0xcc, info.lipstick);
  info.sliders.forEach((x, i) => f(0xd0 + 4 * i, x));
  for (let i = 0; i < info.name.length; i++) v.setUint16(0x180 + 2 * i, info.name.charCodeAt(i), true);
  return d;
}

/** The age slider: years = slider * 47 + 18 (18..65). orig: StarMaker_AgeFromSlider 0x00427130 */
export const ageYearsFromSlider = (slider: number) => f32(f32(slider * 47) + 18);

/** The age morph for an age in years: 0 below 30, +0.025 per year, 1.0 at 70. orig: CharacterModel_SetAgeMorph 0x009D63A0 */
export function ageMorphFromYears(years: number): number {
  const m = f32(f32(years - 30) * f32(0.025));
  return m < 0 ? 0 : m > 1 ? 1 : m;
}
