import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import "@babylonjs/core/Meshes/instancedMesh"; // side effect: adds Mesh.createInstance
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { Rgba } from "../formats/Dds.ts";
import { AutoAnimator } from "../sim/anim/AutoAnimation.ts";
import { PersonAnimator } from "../sim/anim/PersonAnimation.ts";
import { registerShaders } from "./shaders.ts";
import { makeTexture, setTextureAnisotropy } from "./textures.ts";
import { PersonMeshes } from "./PersonMeshes.ts";
import type { MeshAsset, PersonInWorld, TerrainData, WorldData } from "./WorldData.ts";

/**
 * Coordinates. The game is right-handed with z up and the ground in x, y (seen from above: x right, y up). Babylon is left-handed with y up.
 * Mapping game (x, y, z) to Babylon (x, z, y) keeps the same top-down picture; being a mirror, it reverses triangle winding.
 */

/**
 * Ground texture size in world units: the draw routine at 0x9e6360 scales the texture matrix by 1/12 for the ground passes (0x3daaaaab) and by 1/4 for the
 * sidewalk pass (0x3e800000), so one tile is 12 units of ground and 4 units of sidewalk.
 */
const GROUND_TILE = 12;
const PATH_TILE = 4;

/**
 * The part of the terrain the game draws. The terrain is 8 x 8 chunks of 64 units; `FUN_009e2950` (called for every chunk when the terrain is loaded) clears
 * the "enabled" flag of chunks with x index 0 or 7 and y index below 2, and the draw routine skips chunks without it. Chunk i covers -256 + 64 i, so the
 * game draws x -192 to 192 and y -128 to 256 and nothing else. (The city boundary objects of outsidelot_high.rob stand at x = +-192.)
 */
const TERRAIN = { minX: -192, maxX: 192, minZ: -128, maxZ: 256 };

/** Textures the game uses for reflections, the sky and lightmaps are not drawn as diffuse surfaces yet. */
const NOT_DIFFUSE = ["refl", "envmap", "gen_", "lm_"];

const white: Rgba = { width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) };

function buildTerrain(scene: Scene, t: TerrainData): Mesh {
  const ground = CreateGround("terrain", { width: TERRAIN.maxX - TERRAIN.minX, height: TERRAIN.maxZ - TERRAIN.minZ, subdivisions: 1 }, scene);
  ground.position.set((TERRAIN.minX + TERRAIN.maxX) / 2, 0, (TERRAIN.minZ + TERRAIN.maxZ) / 2);
  ground.bakeCurrentTransformIntoVertices(); // the shader reads world x, z from the vertex positions
  const mat = new ShaderMaterial("terrain", scene, "otmTerrain", {
    attributes: ["position"],
    uniforms: ["worldViewProjection", "tileSize", "pathTileSize", "pathOn"],
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
  mat.setFloat("pathOn", 1);
  // Models have ground patches lying exactly at height 0 (the gatehouse's, the gate's base): the same depth as the terrain, which flickers
  // as the camera moves. Push the terrain slightly back in depth so anything lying on it always wins.
  mat.zOffset = 2;
  mat.zOffsetUnits = 2;
  ground.material = mat;
  ground.isPickable = false;
  return ground;
}

/** No cutaway: every fragment is below this world height. */
export const NO_CUT = 1e6;
/** Height above the ground at which a hovered building's shell is cut away. A first value (docs/MSH_FORMAT.md: the offline cutaway view uses 2.5); the game's own is not read. */
export const CUT_HEIGHT = 2.5;

/** Engine objects shared by every model: textures and materials are created once per file, not once per placed object. */
interface Caches {
  textures: Map<string, RawTexture>;
  materials: Map<string, ShaderMaterial | null>;
}

/**
 * Build the geometry of one model file: one hidden source mesh per primitive. Placed objects are drawn as instances of these, so a model the save
 * places 40 times (a hedge, a lamp) costs one draw call per material rather than 40.
 */
function buildSources(scene: Scene, m: MeshAsset, caches: Caches, cut = false): Mesh[] {
  const suffix = cut ? "|cut" : ""; // the cutaway variant of a model has its own materials, which drop everything above CUT_HEIGHT
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
    // A material whose second slot is not a lightmap (lm_*) is two-layer: slot 2 is the base (the gate's flag cloth) and slot 0 is laid over it by alpha (the logo).
    const slot2 = m.msh.textures[mat.tex[2]];
    if (slot2 && !slot2.toLowerCase().startsWith("lm_")) {
      const dkey = `decal|${slot2.toLowerCase()}|${diffuseName.toLowerCase()}${suffix}`;
      if (caches.materials.has(dkey)) return caches.materials.get(dkey)!;
      const base = tex(slot2), decal = tex(diffuseName);
      let dm: ShaderMaterial | null = null;
      if (base && decal) {
        dm = new ShaderMaterial(dkey, scene, "otmDecal", { attributes: ["position", "uv", "uv2"], uniforms: ["world", "viewProjection", "cutHeight"], samplers: ["base", "decal"] });
        dm.setTexture("base", base);
        dm.setTexture("decal", decal);
        dm.setFloat("cutHeight", cut ? CUT_HEIGHT : NO_CUT);
        dm.backFaceCulling = false; // cloth is seen from both sides
      }
      caches.materials.set(dkey, dm);
      return dm;
    }
    const lmName = hasUv2 ? m.msh.textures[mat.tex[2]] : undefined;
    const key = `${diffuseName.toLowerCase()}|${lmName?.toLowerCase() ?? ""}${suffix}`;
    if (caches.materials.has(key)) return caches.materials.get(key)!;
    let result: ShaderMaterial | null = null;
    const diffuse = tex(diffuseName);
    const lightmap = lmName ? tex(lmName) : null;
    if (diffuse) {
      result = new ShaderMaterial(key, scene, "otmStatic", {
        attributes: ["position", "uv", "uv2"],
        uniforms: ["world", "viewProjection", "useLightmap", "cutHeight"],
        samplers: ["diffuse", "lightmap"],
      });
      result.setTexture("diffuse", diffuse);
      result.setTexture("lightmap", lightmap ?? diffuse);
      result.setFloat("useLightmap", lightmap ? 1 : 0);
      result.setFloat("cutHeight", cut ? CUT_HEIGHT : NO_CUT);
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
    const mesh = new Mesh(`${m.name}/${i}${cut ? "/cut" : ""}`, scene);
    const data = new VertexData();
    data.positions = positions;
    data.normals = normals;
    data.uvs = p.uv;
    if (p.uv2) data.uvs2 = p.uv2;
    data.indices = Uint32Array.from(p.indices);
    data.applyToMesh(mesh, p.skin !== null); // skinned primitives (flags) get new vertices every frame
    mesh.metadata = { primitive: i };
    mesh.material = material;
    mesh.isVisible = false; // only its instances are drawn
    mesh.isPickable = false;
    sources.push(mesh);
  });
  return sources;
}


/**
 * Draw the people (docs/PEOPLE.md). Each person is a node at their saved world position, turned by their saved facing the way placed assets are
 * (`rotation.y = -angle`; game counter-clockwise = Babylon clockwise in the mirrored space), holding a mesh per model part (body, head, hair) in the
 * game's (x, y, z up) -> Babylon (x, z, y) mapping. Parts are lit by their texture alone for now (the game's people take the lightmap of where they stand).
 * The node and its meshes carry `metadata.person` for picking.
 */
function buildPeople(scene: Scene, people: PersonInWorld[]): { nodes: TransformNode[]; step(dtMs: number): void; clips: () => { name: string; clip: string; source: string }[] } {
  const materials = new Map<string, StandardMaterial>();
  const nodes: TransformNode[] = [];
  const animated: { animator: PersonAnimator; entry: PersonInWorld; meshes: PersonMeshes }[] = [];
  for (const entry of people) {
    const { person } = entry;
    const meshes = new PersonMeshes(scene, entry, `person/${person.id}`, materials, { person: { id: person.id, cls: person.cls, name: person.name } });
    meshes.node.position.set(person.position[0], person.position[2], person.position[1]);
    meshes.node.rotation.y = -person.angle;
    nodes.push(meshes.node);
    if (entry.plan && meshes.hasSkin) animated.push({ animator: new PersonAnimator(entry.skeleton, entry.clips, entry.plan), entry, meshes });
  }
  const step = (dtMs: number) => {
    for (const { animator, meshes } of animated) {
      const transforms = animator.step(dtMs);
      if (transforms) meshes.applyPose(transforms);
    }
  };
  return { nodes, step, clips: () => animated.map((a) => ({ name: a.entry.person.name, clip: a.animator.clipName, source: a.entry.plan!.source })) };
}

export interface BuiltWorld {
  camera: ArcRotateCamera;
  /** The buildings that have rooms, by `<source>#<id>`: the normal instances (enabled) and the cutaway ones (disabled until the building is hovered). */
  instances: Map<string, { full: InstancedMesh[]; cut: InstancedMesh[] }>;
  /**
   * Move every auto-animated model (the flags) on by the real time since the last rendered frame, in milliseconds. Call once per drawn frame;
   * it is deliberately independent of the game clock, as in the original (`AutoAnimation.ts`).
   */
  stepAutoAnimations(dtMs: number): void;
  /** One node per person drawn. */
  people: TransformNode[];
  /** Move every person's animation on by `dtMs` of game time (0 = paused: nothing moves). */
  stepPeople(dtMs: number): void;
  /** What each animated person is playing now, for the dev menu. */
  peopleClips(): { name: string; clip: string; source: string }[];
  /** How many models are auto-animated here (for the dev menu). */
  autoAnimated: { model: string; clip: () => number }[];
}

/** Draw a loaded world into a scene: the ground and every placed model, with an orbit camera framing the lot and its facilities. */
export function buildWorld(scene: Scene, canvas: HTMLCanvasElement, world: WorldData, options: { anisotropy?: number } = {}): BuiltWorld {
  setTextureAnisotropy(options.anisotropy ?? 8);
  registerShaders();
  if (world.terrain) buildTerrain(scene, world.terrain);
  const caches: Caches = { textures: new Map(), materials: new Map() };
  const sources = new Map<MeshAsset, Mesh[]>();
  for (const mesh of world.meshes) sources.set(mesh, buildSources(scene, mesh, caches));

  // Frame the lot and its facilities: the centre of their positions, seen from the road side (south), looking north.
  const cutSources = new Map<MeshAsset, Mesh[]>();
  for (const mesh of world.meshes) if (mesh.rooms.some((r) => r.lines.length)) cutSources.set(mesh, buildSources(scene, mesh, caches, true));
  const instances = new Map<string, { full: InstancedMesh[]; cut: InstancedMesh[] }>();
  const framed: [number, number][] = [];
  for (const { asset, mesh, scale } of world.placements) {
    const [x, y, z] = asset.position;
    const key = `${asset.source}#${asset.id}`;
    const place = (source: Mesh, name: string, cutaway: boolean) => {
      const inst = source.createInstance(name);
      // The lot's z is 0 in the fresh-studio save but 1000 in the Quick Start saves (what it means is unknown); its meshes belong on the ground either way.
      inst.position.set(x, asset.cls === "CLot" ? 0 : z, y);
      if (scale && scale !== 1) inst.scaling.setAll(scale);
      inst.rotation.y = -asset.angle; // counter-clockwise seen from above in the game = this in the mirrored space
      inst.isPickable = true; // the dev menu reports the last object clicked
      inst.metadata = { cls: asset.cls, id: asset.id, source: asset.source, model: mesh.name, position: asset.position, angle: asset.angle, key, rooms: mesh.rooms };
      inst.freezeWorldMatrix(); // placed objects do not move
      if (cutaway) inst.setEnabled(false); // shown while the building is hovered
      return inst;
    };
    const full = sources.get(mesh)!.map((source, i) => place(source, `${key}/${i}`, false));
    const cuts = cutSources.get(mesh);
    if (cuts) instances.set(key, { full, cut: cuts.map((source, i) => place(source, `${key}/${i}/cut`, true)) });
    if (asset.cls === "CLot" || asset.source === "outside/lot_gate" || asset.source.startsWith("facility/")) framed.push([x, y]);
  }
  // Auto-animated models: one animator per model file, writing the skinned vertices of its (shared) source meshes each frame.
  const animators: { animator: AutoAnimator; targets: { mesh: Mesh; skinned: number }[] }[] = [];
  const autoAnimated: BuiltWorld["autoAnimated"] = [];
  for (const mesh of world.meshes) {
    if (!mesh.autoAnim) continue;
    const animator = new AutoAnimator(mesh.msh, mesh.autoAnim);
    const targets: { mesh: Mesh; skinned: number }[] = [];
    for (const src of [...(sources.get(mesh) ?? []), ...(cutSources.get(mesh) ?? [])]) {
      const skinned = animator.skinned.findIndex((s) => s.primitive === (src.metadata as { primitive: number } | null)?.primitive);
      if (skinned >= 0) targets.push({ mesh: src, skinned });
    }
    if (!targets.length) continue;
    animators.push({ animator, targets });
    autoAnimated.push({ model: mesh.name, clip: () => animator.clip });
  }
  const swizzled = new Map<Mesh, { p: Float32Array; n: Float32Array }>();
  const stepAutoAnimations = (dtMs: number) => {
    for (const { animator, targets } of animators) {
      animator.step(dtMs);
      for (const { mesh, skinned } of targets) {
        const s = animator.skinned[skinned]!;
        let buf = swizzled.get(mesh);
        if (!buf) swizzled.set(mesh, (buf = { p: new Float32Array(s.positions.length), n: new Float32Array(s.normals.length) }));
        for (let v = 0; v < s.positions.length; v += 3) {
          buf.p[v] = s.positions[v]!; buf.p[v + 1] = s.positions[v + 2]!; buf.p[v + 2] = s.positions[v + 1]!; // game (x, y, z) -> Babylon (x, z, y)
          buf.n[v] = s.normals[v]!; buf.n[v + 1] = s.normals[v + 2]!; buf.n[v + 2] = s.normals[v + 1]!;
        }
        mesh.updateVerticesData(VertexBuffer.PositionKind, buf.p);
        mesh.updateVerticesData(VertexBuffer.NormalKind, buf.n);
      }
    }
  };

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
  const built = buildPeople(scene, world.people);
  return { camera, instances, stepAutoAnimations, autoAnimated, people: built.nodes, stepPeople: built.step, peopleClips: built.clips };
}
