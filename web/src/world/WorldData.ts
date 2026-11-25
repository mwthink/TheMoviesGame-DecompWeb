import type { PakIndex } from "../assets/Pak.ts";
import { decodeDds, type Rgba } from "../formats/Dds.ts";
import { Ini } from "../formats/Ini.ts";
import type { Landscape, PlacedAsset, Save } from "../formats/Jad.ts";
import { parseMsh, type Msh } from "../formats/Msh.ts";
import { parseRob } from "../formats/Rob.ts";
import { lotBounds, lotSize, perimeterPieces, type LotBounds } from "./Perimeter.ts";
import { parseCameraIni, type CameraConfig } from "../camera/GameCamera.ts";
import type { SavedCamera } from "../formats/Jad.ts";

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

/** One distinct model file, loaded once however many times the save places it. */
export interface MeshAsset {
  name: string;
  msh: Msh;
  /** Decoded textures by lower-case file name (diffuse and lightmap textures the model uses). Shared between meshes. */
  textures: Map<string, Rgba>;
}

/** One placed object, pointing at its model. */
export interface Placement {
  asset: PlacedAsset;
  mesh: MeshAsset;
  /** Uniform scale (the outside-the-lot scenery has scaled trees); 1 when absent. */
  scale?: number;
}

export interface WorldData {
  /** The gameplay camera's settings (`data\\ui\\camera.ini`); null if the archives have none. */
  camera: CameraConfig | null;
  /** The lot rectangle the gameplay camera stays inside, and the camera the save stored. Null when the save has no lot. */
  lot: { bounds: LotBounds; savedCamera: SavedCamera | null } | null;
  terrain: TerrainData | null;
  meshes: MeshAsset[];
  placements: Placement[];
  warnings: string[];
}

/**
 * Texture files live under `data\\textures\\`: the main folder, and subfolders for lightmaps, props, backdrops and studio logos. Same-named
 * thumbnails live under `data\\textures\\thumbs\\` and must not be picked. The plain folder wins, then the newest archive.
 */
export function findTexture(pak: PakIndex, name: string) {
  const all = pak.findAll(name).filter((f) => {
    const d = f.dir.toLowerCase();
    return d.startsWith("data\\textures\\") && !d.includes("thumbs");
  });
  return all.find((f) => f.dir.toLowerCase() === "data\\textures\\") ?? all[0];
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
  let lot: WorldData["lot"] = null;

  let camera: CameraConfig | null = null;
  const cameraIni = pak.find("camera.ini", { dir: "data\\ui\\" });
  if (cameraIni) {
    const parsed = parseCameraIni(new TextDecoder().decode(await pak.read(cameraIni)));
    camera = parsed.config;
    warnings.push(...parsed.problems);
  } else {
    warnings.push("data\\ui\\camera.ini not found: no game camera");
  }

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

  const textureCache = new Map<string, Promise<Rgba | null>>();
  const texture = (name: string): Promise<Rgba | null> => {
    const key = name.toLowerCase();
    let t = textureCache.get(key);
    if (!t) {
      t = (async () => {
        const f = findTexture(pak, key);
        return f ? decodeDds(await pak.read(f)) : null;
      })();
      textureCache.set(key, t);
    }
    return t;
  };

  const meshCache = new Map<string, Promise<MeshAsset | null>>();
  const loadMesh = (meshName: string): Promise<MeshAsset | null> => {
    let m = meshCache.get(meshName);
    if (!m) {
      m = (async () => {
        const bytes = await pak.readByName(meshName);
        if (!bytes) return null;
        const msh = parseMsh(bytes);
        const wanted = new Set<string>();
        for (const p of msh.primitives) {
          const mat = msh.materials[p.material];
          if (!mat) continue;
          const diffuse = msh.textures[mat.tex[0]];
          if (diffuse) wanted.add(diffuse.toLowerCase());
          const lm = msh.textures[mat.tex[2]];
          if (lm && p.uv2) wanted.add(lm.toLowerCase());
        }
        const textures = new Map<string, Rgba>();
        for (const name of wanted) {
          const img = await texture(name);
          if (img) textures.set(name, img);
          else warnings.push(`${meshName}: texture ${name} not found`);
        }
        return { name: meshName, msh, textures };
      })();
      meshCache.set(meshName, m);
    }
    return m;
  };

  /** A scenery name is a blueprint ini (whose `mesh` names the model) or a model's own name. */
  const loadByName = async (name: string): Promise<MeshAsset | null> => {
    for (const f of pak.findAll(`${name}.ini`)) {
      const mesh = Ini.parse(new TextDecoder().decode(await pak.read(f))).get("mesh");
      if (mesh) return loadMesh(mesh);
    }
    return pak.find(`${name}.msh`) ? loadMesh(`${name}.msh`) : null;
  };
  const missingScenery = new Set<string>();
  const placedMeshNames = new Map<number, string>(); // saved placements' model names, to avoid drawing the same object from two sources
  const placements: Placement[] = [];
  // the lot comes last so that the objects the save places are known when its scenery is added
  const order = [...save.placed.filter((p) => p.cls !== "CLot"), ...save.placed.filter((p) => p.cls === "CLot")];
  for (const asset of order) {
    const slash = asset.source.indexOf("/");
    const folder = slash > 0 ? asset.source.slice(0, slash) : "";
    const stem = asset.source.slice(slash + 1);
    try {
      let meshName: string | undefined;
      if (asset.cls === "CLot") {
        // The camera's lot rectangle needs lot.ini's tier size whichever way the surroundings are drawn.
        const lotIni = pak.find("lot.ini", { dir: "data\\" });
        const size = (lotIni && Ini.parse(new TextDecoder().decode(await pak.read(lotIni))).get("size/2")) || "300,224";
        const [w, d] = size.split(",").map((v) => Number(v.trim()));
        const lot_ = lotSize(w!, d!);
        lot = { bounds: lotBounds(lot_.width, lot_.depth, [asset.position[0], asset.position[1]]), savedCamera: save.lotCamera };
        // lot.ini names no mesh. What surrounds the lot (fence, gate, road markings, the city) is the scenery list outsidelot_high.rob; if the archives
        // lack it, fall back to the fence the game's collision code builds (Perimeter.ts) from the gate, wall and corner meshes.
        const rob = await pak.readByName("outsidelot_high.rob");
        if (rob) {
          const taken = save.placed.filter((p) => p.cls !== "CLot");
          const here: Placement[] = [];
          for (const e of parseRob(new TextDecoder().decode(rob))) {
            const mesh = await loadByName(e.name);
            if (!mesh) {
              if (!missingScenery.has(e.name)) { missingScenery.add(e.name); warnings.push(`outside the lot: no model for ${e.name}`); }
              continue;
            }
            // the save places the gatehouse and the billboard itself: do not draw them twice
            if (taken.some((p) => placedMeshNames.get(p.id) === mesh.name && Math.hypot(p.position[0] - e.x, p.position[1] - e.y) < 3)) continue;
            here.push({
              asset: { cls: "LotScenery", id: asset.id, source: `outside/${e.name}`, position: [asset.position[0] + e.x, asset.position[1] + e.y, e.z], angle: e.angle },
              mesh,
              scale: e.scale,
            });
          }
          placements.push(...here);
          continue;
        }
        const meshes = { wall: await loadMesh("lot_wall_concrete.msh"), corner: await loadMesh("lot_wallcorner.msh"), gate: await loadMesh("lot_gate.msh") };
        for (const [kind, m] of Object.entries(meshes)) if (!m) warnings.push(`lot: mesh for the ${kind} not found`);
        for (const piece of perimeterPieces(lot_.width, lot_.depth)) {
          const mesh = meshes[piece.kind];
          if (!mesh) continue;
          const [ox, oy] = asset.position;
          placements.push({
            asset: { cls: piece.kind === "gate" ? "CLot" : "LotPerimeter", id: asset.id, source: `lot/${piece.kind}`, position: [ox + piece.x, oy + piece.y, 0], angle: piece.angle },
            mesh,
          });
        }
        continue;
      } else {
        const iniFile = pak.find(`${stem}.ini`, folder ? { dirHint: `\\${folder}\\` } : {});
        if (!iniFile) throw new Error(`no ${stem}.ini`);
        meshName = Ini.parse(new TextDecoder().decode(await pak.read(iniFile))).get("mesh");
        if (!meshName) throw new Error(`${stem}.ini names no mesh`);
      }
      progress(`Model ${meshName}`);
      const mesh = await loadMesh(meshName);
      if (!mesh) throw new Error(`mesh ${meshName} not found`);
      placements.push({ asset, mesh });
      placedMeshNames.set(asset.id, mesh.name);
    } catch (e) {
      warnings.push(`${asset.source}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const meshes = [...new Set(placements.map((p) => p.mesh))];
  return { camera, lot, terrain, meshes, placements, warnings };
}
