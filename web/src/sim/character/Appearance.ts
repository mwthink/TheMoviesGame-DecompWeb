// How a star's looks are put together from the character parameters: makeup layer file names, the draw order of the face texture layers, hair, iris
// and age effects. Docs: docs/STARMAKER.md sections 9 and 10. The functions are shared engine code, so the same rules build every character's face in
// the game. Pixel work (decoding the DDS layers, alpha-over compositing) is not here: this produces the plan (which files, in which order, with which
// weights).
import { ageMorphFromYears, ageYearsFromSlider, type StarInfo } from "./StarFile.ts";

/** Makeup categories (the argument of MakeupLayer_GetFileName). Categories 0 and 1 both name `mup_eyes_v` files. */
export const MakeupCategory = { EyeMakeupShape: 0, EyeMakeupColour: 1, Lips: 2, Beard: 3, Tattoo: 4, MaleEyebrow: 5, FemaleEyebrow: 6, Nails: 7, Mask: 8 } as const;
export type MakeupCategory = (typeof MakeupCategory)[keyof typeof MakeupCategory];

/** The character parameter types (EyeMakeupColour 2, EyeMakeupShape 3, Lipstick 4, FacialHair 5, Mask 6, MaleEyebrow 10, FemaleEyebrow 11, Nails 12,
 * Tattoo 13) and the categories they select; unknown types give 0. orig: CharacterParam_TypeToMakeupCategory 0x009CD5E0 */
export function makeupCategoryForParamType(paramType: number): number {
  return ({ 2: 1, 4: 2, 5: 3, 6: 8, 10: 5, 11: 6, 12: 7, 13: 4 } as Record<number, number>)[paramType] ?? 0;
}

const PREFIX = ["mup_eyes_v", "mup_eyes_v", "mup_lips_v", "mup_beard_v", "mup_tatoo_v", "mup_meyebrow_v", "mup_feyebrow_v", "mup_nails_v", "mup_mask_v"];

/** "" for index 0 (none), else <prefix> + (index - 1) in at least two digits + ".dds". orig: MakeupLayer_GetFileName 0x00A5EE00 */
export function makeupLayerFileName(category: MakeupCategory, index: number): string {
  if (index < 1) return "";
  const prefix = PREFIX[category];
  if (!prefix) return "";
  return `${prefix}${String(index - 1).padStart(2, "0")}.dds`;
}

/** The number of choices of a category with `fileCount` files (the highest file index + 1), including "none". orig: MakeupLayer_GetOptionCount 0x00A5EF20 */
export const makeupOptionCount = (fileCount: number) => fileCount + 1;

const HAIR_SUFFIX = ["", "_bd", "_bk", "_rd", "_db", "_px"];

/** The exe's hair colour suffix table (0..5): "", _bd (blond), _bk (black), _rd (red), _db (dark brown), _px (platinum). */
export const hairColourSuffix = (index: number) => HAIR_SUFFIX[index] ?? "";

/** Eye colour: the atlas eyes.dds (256x256) holds eight irises in two rows of four 64-pixel cells; the eye mesh's UVs sit in cell 0. */
export function irisUvOffset(index: number): { u: number; v: number } {
  const cell = index < 0 ? 0 : index % 8;
  return { u: (cell % 4) * 0.25, v: Math.floor(cell / 4) * 0.25 };
}

/** Hair and beard textures show their grey (`_gy`) variant over the coloured one at alpha = the age morph.
 * orig: CharacterHead_ComposeHairTexture 0x00A176D0, CharacterHead_ComposeFaceLayers 0x00A17300 */
export function greyOverlayAlpha(ageMorph: number): number {
  const a = Math.trunc(Math.fround(Math.fround(ageMorph * 255) + 0.5));
  return a < 0 ? 0 : a > 255 ? 255 : a;
}

export interface FaceLayer {
  /** the layer file (512x512 DXT5 with alpha, in the face texture's UVs) */
  file: string;
  /** eye makeup only: the colour layer drawn with the shape (file = shape) */
  colourFile: string;
  /** beard and hair: the `_gy` variant to blend over `file` */
  greyFile: string;
  /** 0..255, greyOverlayAlpha(age morph) */
  greyAlpha: number;
}

/** The texture of a hair mesh or layer for a colour: stem (the name without .msh/.dds) + suffix + ".dds". */
export const hairTextureFile = (stem: string, hairColour: number) => `${stem}${hairColourSuffix(hairColour)}.dds`;

/**
 * The face texture layers in draw order, over the base head texture (two head textures mixed by the skin blend first). The game's slot order: the eye
 * makeup pair (only when a shape is chosen; the colour alone draws nothing), lips, beard, tattoo (not used by stars), eyebrows (male or female by
 * gender), nails (skipped), mask; a texture-layer hair style (a .msh with no geometry) comes last. hairIsTexture: the hair file has no geometry (the
 * caller reads that from the .msh). orig: CharacterHead_ComposeFaceLayers 0x00A17300
 */
export function buildFaceLayerPlan(star: StarInfo, hairIsTexture: boolean): FaceLayer[] {
  const plan: FaceLayer[] = [];
  const alpha = greyOverlayAlpha(ageMorphFromYears(ageYearsFromSlider(star.ageSlider)));
  const suffix = hairColourSuffix(star.hairColour);
  const layer = (file: string, extra: Partial<FaceLayer> = {}): FaceLayer => ({ file, colourFile: "", greyFile: "", greyAlpha: 0, ...extra });
  if (star.eyeMakeup >= 1 && star.makeupColour >= 1) {
    plan.push(layer(makeupLayerFileName(MakeupCategory.EyeMakeupShape, star.eyeMakeup), { colourFile: makeupLayerFileName(MakeupCategory.EyeMakeupColour, star.makeupColour) }));
  }
  if (star.lipstick >= 1) plan.push(layer(makeupLayerFileName(MakeupCategory.Lips, star.lipstick)));
  if (star.beard >= 1) {
    const stem = makeupLayerFileName(MakeupCategory.Beard, star.beard).slice(0, -4);
    plan.push(layer(`${stem}${suffix}.dds`, { greyFile: `${stem}${suffix}_gy.dds`, greyAlpha: alpha }));
  }
  if (star.eyebrow >= 1) plan.push(layer(makeupLayerFileName(star.gender === 1 ? MakeupCategory.MaleEyebrow : MakeupCategory.FemaleEyebrow, star.eyebrow)));
  if (hairIsTexture && star.hair.length > 4) {
    const stem = star.hair.slice(0, -4);
    plan.push(layer(`${stem}${suffix}.dds`, { greyFile: `${stem}${suffix}_gy.dds`, greyAlpha: alpha }));
  }
  return plan;
}

// ---- facial expressions (docs/STARMAKER.md section 8) ----

/**
 * A .fan file (Data\Animations\Facials\<name>.fan, 28 bytes): [entry count, 0, expression frame, intensity, 0, flag word, 0]. frame is the frame of the
 * head's expression animation, intensity the strength it is played at. The flag word (99, 998, 9998 ...) is not understood.
 */
export interface FanFile {
  entries: number;
  frame: number;
  intensity: number;
  flagWord: number;
}

/** valid frames 0..52 (FaceController_SetExpression rejects anything else) */
export const EXPRESSION_FRAME_COUNT = 53;

export function parseFan(bytes: Uint8Array): FanFile | undefined {
  if (bytes.length < 28) return undefined;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { entries: v.getUint32(0, true), frame: v.getUint32(8, true), intensity: v.getFloat32(12, true), flagWord: v.getUint32(20, true) };
}

/** "head_m_white_joe.hd" -> "fe_m_white_joe.anm" ("" for a name that is not head_f_* / head_m_* .hd). orig: FUN_00A30360 (the name builder of FUN_00A31110) */
export function expressionAnimationFile(headFile: string): string {
  if (headFile.length < 9 || !(headFile.startsWith("head_f_") || headFile.startsWith("head_m_")) || !headFile.endsWith(".hd")) return "";
  return `fe_${headFile.slice(5, -3)}.anm`;
}
