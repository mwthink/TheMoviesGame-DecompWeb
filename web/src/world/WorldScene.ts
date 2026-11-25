import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Rgba } from "../formats/Dds.ts";
import { registerShaders } from "./shaders.ts";
import type { ModelData, TerrainData, WorldData } from "./WorldData.ts";

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

function buildModel(scene: Scene, m: ModelData, textures: Map<string, RawTexture>): TransformNode {
  const [x, y, z] = m.asset.position;
  const root = new TransformNode(m.asset.source, scene);
  root.position.set(x, z, y);
  root.rotation.y = -m.asset.angle; // counter-clockwise seen from above in the game = this in the mirrored space

  const tex = (name: string) => {
    const key = name.toLowerCase();
    let t = textures.get(key);
    if (!t) {
      const img = m.textures.get(key);
      if (!img) return null;
      t = makeTexture(scene, img);
      textures.set(key, t);
    }
    return t;
  };
  const materials = new Map<string, ShaderMaterial | null>();
  const materialFor = (index: number, hasUv2: boolean): ShaderMaterial | null => {
    const key = `${index}:${hasUv2}`;
    if (materials.has(key)) return materials.get(key)!;
    let result: ShaderMaterial | null = null;
    const mat = m.msh.materials[index];
    const diffuseName = mat ? m.msh.textures[mat.tex[0]] : undefined;
    if (mat && diffuseName && !NOT_DIFFUSE.some((p) => diffuseName.toLowerCase().startsWith(p))) {
      const diffuse = tex(diffuseName);
      const lmName = m.msh.textures[mat.tex[2]];
      const lightmap = hasUv2 && lmName ? tex(lmName) : null;
      if (diffuse) {
        result = new ShaderMaterial(`${m.asset.source}#${index}`, scene, "otmStatic", {
          attributes: ["position", "uv", "uv2"],
          uniforms: ["worldViewProjection", "useLightmap"],
          samplers: ["diffuse", "lightmap"],
        });
        result.setTexture("diffuse", diffuse);
        result.setTexture("lightmap", lightmap ?? diffuse);
        result.setFloat("useLightmap", lightmap ? 1 : 0);
      }
    }
    materials.set(key, result);
    return result;
  };

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
    const indices = new Uint32Array(p.indices.length);
    for (let t = 0; t < p.indices.length; t += 3) {
      indices[t] = p.indices[t]!; // the mirror reverses winding, and so does Babylon's front-face convention: the order stays as in the file
      indices[t + 1] = p.indices[t + 1]!;
      indices[t + 2] = p.indices[t + 2]!;
    }
    const mesh = new Mesh(`${m.asset.source}/${i}`, scene);
    const data = new VertexData();
    data.positions = positions;
    data.normals = normals;
    data.uvs = p.uv;
    if (p.uv2) data.uvs2 = p.uv2;
    data.indices = indices;
    data.applyToMesh(mesh);
    mesh.material = material;
    mesh.parent = root;
    mesh.isPickable = false;
  });
  return root;
}

export interface BuiltWorld {
  camera: ArcRotateCamera;
}

/** Draw a loaded world into a scene: the ground and every placed model, with an orbit camera framing the lot and its facilities. */
export function buildWorld(scene: Scene, canvas: HTMLCanvasElement, world: WorldData): BuiltWorld {
  registerShaders();
  if (world.terrain) buildTerrain(scene, world.terrain);
  const textures = new Map<string, RawTexture>();
  // Frame the lot and its facilities: the centre of their positions, seen from the road side (south), looking north.
  let fx = 0, fz = 0, count = 0;
  for (const model of world.models) {
    const node = buildModel(scene, model, textures);
    if (model.asset.cls === "CLot" || model.asset.source.startsWith("facility/")) {
      fx += node.position.x;
      fz += node.position.z;
      count++;
    }
  }
  const focus = count ? new Vector3(fx / count, 2, fz / count) : Vector3.Zero();

  const camera = new ArcRotateCamera("camera", -Math.PI / 2, 1.0, 80, focus, scene);
  camera.minZ = 1; // a larger near plane (and shorter far plane) keeps depth precision for distant surfaces
  camera.maxZ = 1200;
  camera.lowerRadiusLimit = 5;
  camera.upperRadiusLimit = 400;
  camera.upperBetaLimit = Math.PI / 2 - 0.03; // stay above the ground
  camera.wheelPrecision = 5;
  camera.panningSensibility = 60;
  camera.attachControl(canvas, true);
  return { camera };
}
