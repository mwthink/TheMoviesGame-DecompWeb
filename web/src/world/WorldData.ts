import type { PakIndex } from "../assets/Pak.ts";
import { decodeDds, type Rgba } from "../formats/Dds.ts";
import { Ini } from "../formats/Ini.ts";
import type { Landscape, PlacedAsset, Save } from "../formats/Jad.ts";
import { parseMsh, type Msh } from "../formats/Msh.ts";

/** Everything needed to draw the ground, as plain arrays (no engine types, so it can be tested in Node). */
export interface TerrainData {
  /** One RGBA8 image per ground texture, indexed like the landscape's texture list. Null if the archive has no such file. */
  groundTextures: (Rgba | null)[];
  /** Per-vertex blend weights of up to 8 ground textures, 256 x 256 texels, row = y: A holds textures 0-3, B holds 4-7. */
  weightsA: Uint8Array;
  weightsB: Uint8Array;
  /** 256 x 256 texels, 255 where the cell is a paved path. */
  path: Uint8Array;
  /** Index into `groundTextures` of the sidewalk texture drawn on path cells, or -1. */
  sidewalk: number;
}

export interface ModelData {
  asset: PlacedAsset;
  msh: Msh;
  /** Decoded textures by lower-case file name, for the diffuse and lightmap textures the model uses. */
  textures: Map<string, Rgba>;
}

export interface WorldData {
  terrain: TerrainData | null;
  models: ModelData[];
  warnings: string[];
}

const TEXTURE_DIRS = ["data\\textures\\", "data\\textures\\lightmap\\", "data\\textures\\ui\\logos\\"];

/** Texture files live in `data\textures\` (lightmaps in a subfolder). Same-named thumbnails elsewhere must not be picked. */
export function findTexture(pak: PakIndex, name: string) {
  for (const dir of TEXTURE_DIRS) {
    const f = pak.find(name, { dir });
    if (f) return f;
  }
  return undefined;
}

/**
 * Turn the three paint layers of every terrain vertex into blend weights (docs/SAVE_FORMAT.md): layer 0 is opaque, layers 1 and 2 paint over it with
 * alpha (bits 4-5 + 1) * 0.25. Compositing colours with these alphas equals a weighted sum of the textures, so the weights can be interpolated
 * by the GPU and applied per pixel to the sampled textures.
 */
export function computeSplat(land: Landscape): { weightsA: Uint8Array; weightsB: Uint8Array; path: Uint8Array } {
  const n = Math.min(land.textures.length, 8);
  const weightsA = new Uint8Array(256 * 256 * 4);
  const weightsB = new Uint8Array(256 * 256 * 4);
  const path = new Uint8Array(256 * 256);
  const w = new Float64Array(8);
  for (let x = 0; x < 256; x++) {
    for (let y = 0; y < 256; y++) {
      w.fill(0);
      let any = false;
      for (let layer = 0; layer < 3; layer++) {
        const value = land.cells[(x * 256 + y) * 3 + layer]!;
        const t = value & 15;
        if (t >= n) continue; // 0xF = no texture
        const a = layer && any ? (((value >> 4) & 3) + 1) * 0.25 : 1;
        for (let i = 0; i < 8; i++) w[i]! *= 1 - a;
        w[t]! += a;
        any = true;
      }
      const o = (y * 256 + x) * 4;
      for (let i = 0; i < 4; i++) {
        weightsA[o + i] = Math.round(w[i]! * 255);
        weightsB[o + i] = Math.round(w[4 + i]! * 255);
      }
      const bit = x * 256 + y;
      path[y * 256 + x] = (land.path[bit >> 3]! >> (bit & 7)) & 1 ? 255 : 0;
    }
  }
  return { weightsA, weightsB, path };
}

/** Load a saved game's world from the game archives: ground textures, and the model and textures of every placed asset that has one. */
export async function loadWorldData(pak: PakIndex, save: Save, progress: (text: string) => void = () => {}): Promise<WorldData> {
  const warnings: string[] = [];
  let terrain: TerrainData | null = null;

  if (save.landscape) {
    progress("Ground textures");
    const land = save.landscape;
    const groundTextures: (Rgba | null)[] = [];
    for (const name of land.textures.slice(0, 8)) {
      const file = findTexture(pak, `${name.toLowerCase()}.dds`);
      if (!file) {
        warnings.push(`ground texture ${name} not found`);
        groundTextures.push(null);
      } else {
        groundTextures.push(decodeDds(await pak.read(file)));
      }
    }
    terrain = {
      groundTextures,
      ...computeSplat(land),
      sidewalk: land.textures.findIndex((t) => t.toLowerCase().startsWith("land_sidewalk")),
    };
  }

  const models: ModelData[] = [];
  const seen = new Map<string, Promise<Msh | null>>();
  for (const asset of save.placed) {
    const slash = asset.source.indexOf("/");
    const folder = slash > 0 ? asset.source.slice(0, slash) : "";
    const stem = asset.source.slice(slash + 1);
    try {
      progress(`Model ${stem}`);
      let meshName: string | undefined;
      if (asset.cls === "CLot") {
        // lot.ini names no mesh. The front gate, flag and walls of the lot are lot_gate.msh; which mesh the game picks, and how it places it
        // (here: at the lot's origin), is not read from the code yet.
        meshName = "lot_gate.msh";
      } else {
        const iniFile = pak.find(`${stem}.ini`, folder ? { dirHint: `\\${folder}\\` } : {});
        if (!iniFile) throw new Error(`no ${stem}.ini`);
        meshName = Ini.parse(new TextDecoder().decode(await pak.read(iniFile))).get("mesh");
        if (!meshName) throw new Error(`${stem}.ini names no mesh`);
      }
      if (!seen.has(meshName)) {
        seen.set(meshName, (async () => {
          const bytes = await pak.readByName(meshName);
          return bytes ? parseMsh(bytes) : null;
        })());
      }
      const msh = await seen.get(meshName)!;
      if (!msh) throw new Error(`mesh ${meshName} not found`);

      const wanted = new Set<string>();
      for (const p of msh.primitives) {
        const m = msh.materials[p.material];
        if (!m) continue;
        const diffuse = msh.textures[m.tex[0]];
        if (diffuse) wanted.add(diffuse.toLowerCase());
        const lm = msh.textures[m.tex[2]];
        if (lm && p.uv2) wanted.add(lm.toLowerCase());
      }
      const textures = new Map<string, Rgba>();
      for (const name of wanted) {
        const f = findTexture(pak, name);
        if (f) textures.set(name, decodeDds(await pak.read(f)));
        else warnings.push(`${meshName}: texture ${name} not found`);
      }
      models.push({ asset, msh, textures });
    } catch (e) {
      warnings.push(`${asset.source}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { terrain, models, warnings };
}
