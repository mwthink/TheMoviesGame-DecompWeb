import { Constants } from "@babylonjs/core/Engines/constants";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { Rgba } from "../formats/Dds.ts";

/** Texture sharpness at a slant, set per world from the settings (`Settings.anisotropy`). */
let textureAnisotropy = 8;

/** Set the texture sharpness for textures made from now on. */
export function setTextureAnisotropy(level: number): void { textureAnisotropy = level; }

/** A texture from decoded pixels: trilinear with mipmaps by default, tiling, `anisotropicFilteringLevel` from the settings. */
export function makeTexture(scene: Scene, img: Rgba, opts: { mips?: boolean; filter?: number; clamp?: boolean } = {}): RawTexture {
  const mips = opts.mips ?? true;
  const t = new RawTexture(
    img.data, img.width, img.height, Constants.TEXTUREFORMAT_RGBA, scene, mips, false,
    opts.filter ?? (mips ? Texture.TRILINEAR_SAMPLINGMODE : Texture.BILINEAR_SAMPLINGMODE),
  );
  // RawTexture clamps by default; the game's textures tile (ground, and model UVs run well outside 0..1).
  const mode = opts.clamp ? Texture.CLAMP_ADDRESSMODE : Texture.WRAP_ADDRESSMODE;
  t.wrapU = mode;
  t.wrapV = mode;
  if (mips) t.anisotropicFilteringLevel = textureAnisotropy;
  return t;
}


/** A 1 x 1 white image, for parts whose texture could not be found. */
export const WHITE: Rgba = { width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) };
