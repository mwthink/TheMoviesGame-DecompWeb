import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/instancedMesh"; // side effect: adds Mesh.createInstance
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { Rgba } from "../formats/Dds.ts";
import { registerShaders } from "./shaders.ts";
import type { MeshAsset, TerrainData, WorldData } from "./WorldData.ts";

/**
 * Coordinates. The game is right-handed with z up and the ground in x, y (seen from above: x right, y up). Babylon is left-handed with y up.
 * Mapping game (x, y, z) to Babylon (x, z, y) keeps the same top-down picture; being a mirror, it reverses triangle winding.
 */

/** Ground texture size in world units (assumed 12 from the texture-matrix constant 1/12, docs/SAVE_FORMAT.md) and the sidewalk's (2, one path cell). */
const GROUND_TILE = 12;
const PATH_TILE = 2;

/** Textures the game uses for reflections, the sky and lightmaps are not drawn as diffuse surfaces yet. */
const NOT_DIFFUSE = ["refl", "envmap", "gen_", "lm_"];

function makeTexture(scene: Scene, img: Rgba, opts: { mips?: boolean; filter?: number; clamp?: boolean } = {}): RawTexture {
  const mips = opts.mips ?? true;
  const t = new RawTexture(
    img.data, img.width, img.height, Constants.TEXTUREFORMAT_RGBA, scene, mips, false,
    opts.filter ?? (mips ? Texture.TRILINEAR_SAMPLINGMODE : Texture.BILINEAR_SAMPLINGMODE),
  );
  // RawTexture clamps by default; the game's textures tile (ground, and model UVs run well outside 0..1).
  const mode = opts.clamp ? Texture.CLAMP_ADDRESSMODE : Texture.WRAP_ADDRESSMODE;
  t.wrapU = mode;
  t.wrapV = mode;
  if (mips) t.anisotropicFilteringLevel = 8;
  return t;
}

const white: Rgba = { width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) };

function buildTerrain(scene: Scene, t: TerrainData): Mesh {
  const ground = CreateGround("terrain", { width: 512, height: 512, subdivisions: 1 }, scene);
  const mat = new ShaderMaterial("terrain", scene, "otmTerrain", {
    attributes: ["position"],
    uniforms: ["worldViewProjection", "tileSize", "pathTileSize"],
    samplers: ["ground0", "ground1", "ground2", "ground3", "ground4", "ground5", "ground6", "ground7", "weightsA", "weightsB", "pathMask", "sidewalk"],
  });
  for (let i = 0; i < 8; i++) mat.setTexture(`ground${i}`, makeTexture(scene, t.groundTextures[i] ?? white));
  const grid = (data: Uint8Array, format: number, filter: number) =>
    new RawTexture(data, 256, 256, format, scene, false, false, filter);
  const wa = grid(t.weightsA, Constants.TEXTUREFORMAT_RGBA, Texture.BILINEAR_SAMPLINGMODE);
  const wb = grid(t.weightsB, Constants.TEXTUREFORMAT_RGBA, Texture.BILINEAR_SAMPLINGMODE);
  const pm = grid(t.path, Constants.TEXTUREFORMAT_R, Texture.NEAREST_SAMPLINGMODE);
  for (const tex of [wa, wb, pm]) {
    tex.wrapU = Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  }
  mat.setTexture("weightsA", wa);
  mat.setTexture("weightsB", wb);
  mat.setTexture("pathMask", pm);
  mat.setTexture("sidewalk", makeTexture(scene, t.groundTextures[t.sidewalk] ?? white));
  mat.setFloat("tileSize", GROUND_TILE);
  mat.setFloat("pathTileSize", PATH_TILE);
  // Models have ground patches lying exactly at height 0 (the gatehouse's, the gate's base): the same depth as the terrain, which flickers
  // as the camera moves. Push the terrain slightly back in depth so anything lying on it always wins.
  mat.zOffset = 2;
  mat.zOffsetUnits = 2;
  ground.material = mat;
  ground.isPickable = false;
  return ground;
}

/** Engine objects shared by every model: textures and materials are created once per file, not once per placed object. */
interface Caches {
  textures: Map<string, RawTexture>;
  materials: Map<string, ShaderMaterial | null>;
}

/**
 * Build the geometry of one model file: one hidden source mesh per primitive. Placed objects are drawn as instances of these, so a model the save
 * places 40 times (a hedge, a lamp) costs one draw call per material rather than 40.
 */
function buildSources(scene: Scene, m: MeshAsset, caches: Caches): Mesh[] {
  const tex = (name: string) => {
    const key = name.toLowerCase();
    let t = caches.textures.get(key);
    if (!t) {
      const img = m.textures.get(key);
      if (!img) return null;
      t = makeTexture(scene, img);
      caches.textures.set(key, t);
    }
    return t;
  };
  const materialFor = (index: number, hasUv2: boolean): ShaderMaterial | null => {
    const mat = m.msh.materials[index];
    const diffuseName = mat ? m.msh.textures[mat.tex[0]] : undefined;
    if (!mat || !diffuseName || NOT_DIFFUSE.some((p) => diffuseName.toLowerCase().startsWith(p))) return null;
    const lmName = hasUv2 ? m.msh.textures[mat.tex[2]] : undefined;
    const key = `${diffuseName.toLowerCase()}|${lmName?.toLowerCase() ?? ""}`;
    if (caches.materials.has(key)) return caches.materials.get(key)!;
    let result: ShaderMaterial | null = null;
    const diffuse = tex(diffuseName);
    const lightmap = lmName ? tex(lmName) : null;
    if (diffuse) {
      result = new ShaderMaterial(key, scene, "otmStatic", {
        attributes: ["position", "uv", "uv2"],
        uniforms: ["world", "viewProjection", "useLightmap"],
        samplers: ["diffuse", "lightmap"],
      });
      result.setTexture("diffuse", diffuse);
      result.setTexture("lightmap", lightmap ?? diffuse);
      result.setFloat("useLightmap", lightmap ? 1 : 0);
    }
    caches.materials.set(key, result);
    return result;
  };

  const sources: Mesh[] = [];
  m.msh.primitives.forEach((p, i) => {
    const material = materialFor(p.material, p.uv2 !== null);
    if (!material) return;
    const n = p.positions.length / 3;
    const positions = new Float32Array(n * 3);
    const normals = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      positions.set([p.positions[v * 3]!, p.positions[v * 3 + 2]!, p.positions[v * 3 + 1]!], v * 3);
      normals.set([p.normals[v * 3]!, p.normals[v * 3 + 2]!, p.normals[v * 3 + 1]!], v * 3);
    }
    // The mirror reverses winding, and so does Babylon's front-face convention: the triangle order stays as in the file.
    const mesh = new Mesh(`${m.name}/${i}`, scene);
    const data = new VertexData();
    data.positions = positions;
    data.normals = normals;
    data.uvs = p.uv;
    if (p.uv2) data.uvs2 = p.uv2;
    data.indices = Uint32Array.from(p.indices);
    data.applyToMesh(mesh);
    mesh.material = material;
    mesh.isVisible = false; // only its instances are drawn
    mesh.isPickable = false;
    sources.push(mesh);
  });
  return sources;
}

export interface BuiltWorld {
  camera: ArcRotateCamera;
}

/** Draw a loaded world into a scene: the ground and every placed model, with an orbit camera framing the lot and its facilities. */
export function buildWorld(scene: Scene, canvas: HTMLCanvasElement, world: WorldData): BuiltWorld {
  registerShaders();
  if (world.terrain) buildTerrain(scene, world.terrain);
  const caches: Caches = { textures: new Map(), materials: new Map() };
  const sources = new Map<MeshAsset, Mesh[]>();
  for (const mesh of world.meshes) sources.set(mesh, buildSources(scene, mesh, caches));

  // Frame the lot and its facilities: the centre of their positions, seen from the road side (south), looking north.
  const framed: [number, number][] = [];
  for (const { asset, mesh } of world.placements) {
    const [x, y, z] = asset.position;
    for (const [i, source] of sources.get(mesh)!.entries()) {
      const inst = source.createInstance(`${asset.source}#${asset.id}/${i}`);
      // The lot's z is 0 in the fresh-studio save but 1000 in the Quick Start saves (what it means is unknown); its meshes belong on the ground either way.
      inst.position.set(x, asset.cls === "CLot" ? 0 : z, y);
      inst.rotation.y = -asset.angle; // counter-clockwise seen from above in the game = this in the mirrored space
      inst.isPickable = false;
      inst.freezeWorldMatrix(); // placed objects do not move
    }
    if (asset.cls === "CLot" || asset.source.startsWith("facility/")) framed.push([x, y]);
  }
  let cx = 0, cy = 0;
  for (const [x, y] of framed) { cx += x; cy += y; }
  if (framed.length) { cx /= framed.length; cy /= framed.length; }
  const spread = framed.reduce((m, [x, y]) => Math.max(m, Math.hypot(x - cx, y - cy)), 0);
  const focus = new Vector3(cx, 2, cy);

  const camera = new ArcRotateCamera("camera", -Math.PI / 2, 1.0, Math.max(80, spread * 2.4), focus, scene);
  camera.minZ = 1; // a larger near plane (and shorter far plane) keeps depth precision for distant surfaces
  camera.maxZ = 1200;
  camera.lowerRadiusLimit = 5;
  camera.upperRadiusLimit = 500;
  camera.upperBetaLimit = Math.PI / 2 - 0.03; // stay above the ground
  camera.wheelPrecision = 5;
  camera.panningSensibility = 60;
  camera.attachControl(canvas, true);
  return { camera };
}
