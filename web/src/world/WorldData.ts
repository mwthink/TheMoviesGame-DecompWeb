import type { PakIndex } from "../assets/Pak.ts";
import { decodeDds, type Rgba } from "../formats/Dds.ts";
import { Ini } from "../formats/Ini.ts";
import type { Landscape, PlacedAsset, Save, SaveHeader, SavedPerson, SavedStaff } from "../formats/Jad.ts";
import { parseCos } from "../formats/Cos.ts";
import { firstAnimation, parseFlm } from "../formats/Flm.ts";
import { parseFloorplanRevealing, type RevealRules } from "../sim/ui/FloorplanReveal.ts";
import { parseSeq } from "../formats/Seq.ts";
import { FALLBACK_CLIP, type AnimationPlan } from "../sim/anim/PersonAnimation.ts";
import type { MshBone } from "../formats/Msh.ts";
import { parseHead, type HeadFile } from "../sim/character/HeadFile.ts";
import { ageYears, defaultHeadFor, meshParts, morphedHead, poseParts, STANDING_POSE_CLIP, type ModelPart } from "../sim/character/PersonModel.ts";
import { parseAnm, type Anm } from "../formats/Anm.ts";
import { parseMsh, type Msh, type MshChunk } from "../formats/Msh.ts";
import { clipFits } from "../sim/anim/AutoAnimation.ts";
import { roomLines, type Strings } from "../formats/Lhts.ts";
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
  /** The model's named rooms (`room_*` parts, not the unnamed whole-floor part): the text on the floor (docs/SAVE_FORMAT.md, empty if the room has none or there is no string database) and the floor polygon. */
  rooms: { name: string; lines: string[]; x: number; y: number; chunk: MshChunk }[];
  /** The model's auto-animation clips (`aa_<model>_v00.anm`, `_v01`, ...; docs/AUTO_ANIMATION.md) when it is skinned and has some that fit its skeleton. */
  autoAnim?: Anm[];
}

/**
 * The sky box: `Sky_box.msh` (orig: loaded by the landscape code at 0x009CC160 with `Mesh_LoadCached("Sky_box.msh")`) and the textures of its three variants. The model has four
 * curved sky walls (textures `sky_01_v00` .. `sky_04_v00`), a top cap (`sky_top`) and a 2200-unit ground plane (`land_sand00` with the lightmap `lm_sky`).
 */
async function loadSky(pak: PakIndex, texture: (name: string) => Promise<Rgba | null>, warnings: string[]): Promise<SkyData | null> {
  const bytes = await pak.readByName("sky_box.msh");
  if (!bytes) { warnings.push("sky_box.msh not found: no sky"); return null; }
  const msh = parseMsh(bytes);
  const textures = new Map<string, Rgba>();
  const names = new Set<string>();
  for (const t of msh.textures) {
    names.add(t.toLowerCase());
    const m = /^(sky_\d\d)_v00\.dds$/i.exec(t);
    if (m) for (const v of ["v01", "v02"]) names.add(`${m[1]!.toLowerCase()}_${v}.dds`);
  }
  for (const name of names) {
    const img = await texture(name);
    if (img) textures.set(name, img);
    else warnings.push(`sky texture ${name} not found`);
  }
  return { msh, textures };
}

/** The most clip variants the original loads for a model (`AutoAnimSet_Constructor` names them `aa_<model>_v00` to `_v010`, then `_v`). */
const MAX_AUTO_CLIPS = 11;

/** The middle of a room floor polygon: the triangle centroids weighted by area. */
/**
 * The auto-animation clips of a model: `aa_<model name without .msh>_v00.anm`, `_v01`, ... from `data\\animations\\high\\autoanimated\\`
 * (orig: 0x00A72A60 `AutoAnimSet_GetOrLoad` builds the name, 0x00A71DE0 `AutoAnimSet_Constructor` loads the variants). Only skinned models are looked at, and only clips that fit the skeleton are kept.
 */
export async function loadAutoAnimClips(pak: PakIndex, meshName: string, msh: Msh): Promise<Anm[]> {
  if (!msh.skeleton.length || !msh.primitives.some((p) => p.skin)) return [];
  const stem = meshName.replace(/\.msh$/i, "");
  const clips: Anm[] = [];
  for (let i = 0; i < MAX_AUTO_CLIPS; i++) {
    const bytes = await pak.readByName(`aa_${stem}_v${String(i).padStart(2, "0")}.anm`, { dir: "data\\animations\\high\\autoanimated\\" });
    if (!bytes) break;
    const clip = parseAnm(bytes);
    if (clipFits(msh.skeleton, clip)) clips.push(clip);
  }
  return clips;
}

/** What makes up one person's model: files by name and the numbers the head morph needs. */
export interface PersonSpec {
  /** The costume file, e.g. `m_50s_2.cos`. */
  cos: string;
  /** The head file (`head_f_white_jane.hd`); "" takes the default for the costume's sex. */
  head: string;
  head2?: string;
  headMix?: number;
  /** The hair mesh (`hair_20s_m1.msh`); "" for none. */
  hair: string;
  ageYears: number;
  weightKg: number;
}

/** A person's model in the bind pose: body, head and hair parts, the skeleton they share and the textures they use. */
export interface PersonModel {
  parts: (ModelPart & { cutout: boolean })[];
  skeleton: MshBone[];
  textures: Map<string, Rgba>;
}

/**
 * Builds people's models from the archives, caching what many people share (meshes, heads, the generic head). Used by the world loader and the character viewer.
 * `texture` decodes a texture by file name (null when missing).
 */
export class PersonModelBuilder {
  private readonly pak: PakIndex;
  private readonly texture: (name: string) => Promise<Rgba | null>;
  private readonly meshes = new Map<string, Promise<Msh | null>>();
  private readonly heads = new Map<string, Promise<HeadFile | null>>();

  constructor(pak: PakIndex, texture: (name: string) => Promise<Rgba | null>) {
    this.pak = pak;
    this.texture = texture;
  }

  msh(name: string): Promise<Msh | null> {
    let m = this.meshes.get(name.toLowerCase());
    if (!m) this.meshes.set(name.toLowerCase(), (m = this.pak.readByName(name).then((b) => (b ? parseMsh(b) : null))));
    return m;
  }

  hd(name: string): Promise<HeadFile | null> {
    let h = this.heads.get(name.toLowerCase());
    if (!h) this.heads.set(name.toLowerCase(), (h = this.pak.readByName(name).then((b) => (b ? parseHead(b) : null))));
    return h;
  }

  /** Throws when the costume or its body mesh is missing; a missing head or hair is reported through `warn` and left out. */
  async build(spec: PersonSpec, warn: (text: string) => void = () => {}): Promise<PersonModel> {
    const cosBytes = await this.pak.readByName(spec.cos);
    if (!cosBytes) throw new Error(`no ${spec.cos}`);
    const cos = parseCos(cosBytes);
    const body = await this.msh(cos.body);
    if (!body) throw new Error(`no body mesh ${cos.body}`);
    const parts: PersonModel["parts"] = meshParts(body).map((p) => ({ ...p, cutout: false }));
    const headName = spec.head || defaultHeadFor(spec.cos);
    const first = await this.hd(headName);
    const generic = await this.msh("generic_head.msh");
    if (generic && first) {
      const second = spec.head2 ? await this.hd(spec.head2) : null;
      for (const p of morphedHead(generic, first, second, spec.headMix ?? 0, spec.ageYears, spec.weightKg, first.names[0])) parts.push({ ...p, cutout: false });
    } else warn(`no head ${headName}`);
    if (spec.hair) {
      const hair = await this.msh(spec.hair);
      if (hair) for (const p of meshParts(hair)) parts.push({ ...p, cutout: true });
      else warn(`no hair ${spec.hair}`);
    }
    const textures = new Map<string, Rgba>();
    for (const part of parts) {
      const key = part.texture.toLowerCase();
      if (!key || textures.has(key)) continue;
      const img = await this.texture(key);
      if (img) textures.set(key, img);
    }
    return { parts, skeleton: body.skeleton, textures };
  }
}

/**
 * Everyone the save puts in the world, as drawable models. Placement rule (docs/PEOPLE.md): a saved person's `POSITION` and `MyAngle` are world coordinates
 * (also inside buildings) and the model's origin is at the feet; people at (0, 0) are not in the world (the casting pool) and are skipped, as are people
 * without a costume. The model is the costume's body mesh, the person's head (their `.hd` morph of the generic head, or the default for their sex) and
 * their hair, all in the skeleton's bind pose for now (no animation yet).
 */
async function loadPeople(
  pak: PakIndex, save: Save, texture: (name: string) => Promise<Rgba | null>, warnings: string[], progress: (text: string) => void,
): Promise<PersonInWorld[]> {
  const out: PersonInWorld[] = [];
  const builder = new PersonModelBuilder(pak, texture);
  const clipCache = new Map<string, Promise<Anm | null>>();
  const clip = (name: string) => {
    let c = clipCache.get(name.toLowerCase());
    if (!c) clipCache.set(name.toLowerCase(), (c = pak.readByName(name, { dir: "data\\animations\\high\\" }).then((b) => (b ? parseAnm(b) : null))));
    return c;
  };
  const flmCache = new Map<string, Promise<ReturnType<typeof parseFlm> | null>>();
  const scene = (name: string) => {
    let f = flmCache.get(name);
    if (!f) flmCache.set(name, (f = pak.readByName(name, { dir: "data\\scene\\interactions\\" }).then((b) => (b ? parseFlm(b) : null))));
    return f;
  };
  const today = save.header?.date;
  const poseBytes = await pak.readByName(STANDING_POSE_CLIP);
  const pose: Anm | null = poseBytes ? parseAnm(poseBytes) : null;
  if (!pose) warnings.push(`${STANDING_POSE_CLIP} not found: people are drawn in the bind pose`);
  for (const person of save.people) {
    if (!person.costume?.cos || (person.position[0] === 0 && person.position[1] === 0)) continue;
    try {
      progress(`Person ${person.name || person.id}`);
      const model = await builder.build({
        cos: person.costume.cos, head: person.head, head2: person.head2, headMix: person.headMix, hair: person.costume.hair,
        ageYears: ageYears(person.birth, today), weightKg: person.weight > 0 ? person.weight : 70,
      }, (text) => warnings.push(`${person.name}: ${text}`));
      const { parts, textures } = model;
      const body = { skeleton: model.skeleton };
      const clips = new Map<string, Anm>();
      const plan = await resolvePlan(pak, person, scene, clip, clips, body.skeleton);
      out.push({
        person, bind: parts, skeleton: body.skeleton, plan, clips, textures,
        parts: pose && clipFits(body.skeleton, pose) ? (poseParts(parts, body.skeleton, pose) as PersonInWorld["parts"]) : parts,
      });
    } catch (e) {
      warnings.push(`${person.name || person.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

/**
 * The room scene file a person stands in and the animation it names (docs/PEOPLE.md "Animation"): `ai_<room>_<index>.flm`, else `ai_<room>.flm`; its first
 * character's first animation box is a clip or a `.seq` playlist. Loads the clips the plan can play into `clips`. With no scene (outside, or a room without
 * one) the plan is the fallback idle, and says why in `source`. orig: the game picks the scene in `TMCharacter_PlayInteractionScene` (0x599480).
 */
export async function resolvePlan(
  pak: PakIndex, person: SavedPerson,
  scene: (name: string) => Promise<ReturnType<typeof parseFlm> | null>, clip: (name: string) => Promise<Anm | null>,
  clips: Map<string, Anm>, skeleton: MshBone[],
): Promise<AnimationPlan | null> {
  const load = async (name: string) => {
    if (clips.has(name)) return true;
    const c = await clip(name);
    if (!c || !clipFits(skeleton, c)) return false;
    clips.set(name, c);
    return true;
  };
  const room = person.room;
  if (room && room !== "room_") {
    // the room, then the room with its last word dropped (`room_staff_hire_janitor` uses the `room_staff_hire` scenes)
    const rooms = [room];
    const words = room.split("_");
    if (words.length > 3) rooms.push(words.slice(0, -1).join("_"));
    for (const r of rooms) {
      // scenes come in numbered variants `ai_<room>_00`, `_01`, ... (a few rooms have just `ai_<room>`); the person's saved index picks one, wrapped to what exists;
      // an unset index (-1, saved as 0xFFFFFFFF) takes the person's id so a room's people spread over the variants
      const variants: string[] = [];
      for (let i = 0; i < 40; i++) {
        const name = `ai_${r}_${String(i).padStart(2, "0")}.flm`;
        if (!(await scene(name))) break;
        variants.push(name);
      }
      if (!variants.length && (await scene(`ai_${r}.flm`))) variants.push(`ai_${r}.flm`);
      if (!variants.length) continue;
      const index = person.roomIndex === 0xffffffff ? person.id : person.roomIndex;
      const sceneName = variants[index % variants.length]!;
      const flm = await scene(sceneName);
      const first = flm ? firstAnimation(flm) : null;
      if (!first) continue;
      if (/\.seq$/i.test(first.name)) {
        const bytes = await pak.readByName(first.name, { dir: "data\\animations\\sequences\\" });
        if (!bytes) continue;
        const seq = parseSeq(bytes);
        for (const n of [...seq.clips, ...(seq.baseIdle ? [seq.baseIdle] : [])]) await load(n);
        if (seq.baseIdle && clips.has(seq.baseIdle)) return { source: `${sceneName}: ${first.name}`, clip: seq.baseIdle, seq };
        if (seq.clips.some((n) => clips.has(n))) return { source: `${sceneName}: ${first.name}`, clip: seq.clips.find((n) => clips.has(n))!, seq };
        continue;
      }
      if (await load(first.name)) return { source: `${sceneName}: ${first.name}`, clip: first.name, seq: null };
    }
  }
  const why = room && room !== "room_" ? `no usable scene for ${room}` : "not in a room";
  return (await load(FALLBACK_CLIP)) ? { source: `fallback (${why}): ${FALLBACK_CLIP}`, clip: FALLBACK_CLIP, seq: null } : null;
}

export function chunkCentre(c: MshChunk): { x: number; y: number } {
  let ax = 0, ay = 0, area = 0;
  for (let t = 0; t < c.tris.length; t += 3) {
    const a = c.tris[t]! * 3, b = c.tris[t + 1]! * 3, d = c.tris[t + 2]! * 3;
    const x1 = c.verts[a]!, y1 = c.verts[a + 1]!, x2 = c.verts[b]!, y2 = c.verts[b + 1]!, x3 = c.verts[d]!, y3 = c.verts[d + 1]!;
    const w = Math.abs((x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1)) / 2;
    ax += w * (x1 + x2 + x3) / 3;
    ay += w * (y1 + y2 + y3) / 3;
    area += w;
  }
  if (area > 0) return { x: ax / area, y: ay / area };
  const n = c.verts.length / 3;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += c.verts[i * 3]!; sy += c.verts[i * 3 + 1]!; }
  return { x: n ? sx / n : 0, y: n ? sy / n : 0 };
}

/** One placed object, pointing at its model. */
export interface Placement {
  asset: PlacedAsset;
  mesh: MeshAsset;
  /** Uniform scale (the outside-the-lot scenery has scaled trees); 1 when absent. */
  scale?: number;
}

/** A person standing in the world, with the parts of their model (body, head, hair) in bind pose and the textures those use (docs/PEOPLE.md). */
export interface PersonInWorld {
  person: SavedPerson;
  parts: (ModelPart & { /** hair is drawn with an alpha cut-off */ cutout: boolean })[];
  textures: Map<string, Rgba>;
  /** The parts in the skeleton's bind pose (the input of skinning) and the skeleton, for animation. */
  bind: (ModelPart & { cutout: boolean })[];
  skeleton: MshBone[];
  /** What the person plays (docs/PEOPLE.md "Animation") and the clips that plan needs, by file name; null plan = no animation. */
  plan: AnimationPlan | null;
  clips: Map<string, Anm>;
}

/** The game's sky box (`Sky_box.msh`, docs/SKY.md): its model and the textures of every sky variant. */
export interface SkyData {
  msh: Msh;
  /** Decoded textures by lower-case file name, including every `sky_NN_v00/v01/v02` variant of the four sky walls. */
  textures: Map<string, Rgba>;
}

export interface WorldData {
  /** The sky box and the ground plane around the lot; null if the archives lack `Sky_box.msh`. */
  sky: SkyData | null;
  /** When each building's floor plan is revealed (`data\\floorplans\\floorplanrevealing.csv`); null if the archives lack it. */
  floorplanRules: RevealRules | null;
  /** The people who are in the world (a position and a costume), at their saved positions. */
  people: PersonInWorld[];
  /** The gameplay camera's settings (`data\\ui\\camera.ini`); null if the archives have none. */
  camera: CameraConfig | null;
  /** The lot rectangle the gameplay camera stays inside, and the camera the save stored. Null when the save has no lot. */
  lot: { bounds: LotBounds; savedCamera: SavedCamera | null } | null;
  terrain: TerrainData | null;
  meshes: MeshAsset[];
  placements: Placement[];
  /** The saved game's date and cash, and the people the player's studio employs. */
  header: SaveHeader | null;
  staff: SavedStaff[];
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
export async function loadWorldData(
  pak: PakIndex, save: Save, progress: (text: string) => void = () => {},
  /** The game's string database (stringdatabase.lhts, then the add-on's), for the room labels; without it rooms have no text. */
  strings: Strings | null = null,
): Promise<WorldData> {
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
        const rooms: MeshAsset["rooms"] = [];
        for (const part of msh.parts) {
          if (part.name.toLowerCase() === "room_") continue; // the union of the walkable floor
          rooms.push({ name: part.name, lines: strings ? roomLines(strings, part.name) : [], ...chunkCentre(part.chunk), chunk: part.chunk });
        }
        const asset: MeshAsset = { name: meshName, msh, textures, rooms };
        const clips = await loadAutoAnimClips(pak, meshName, msh);
        if (clips.length) asset.autoAnim = clips;
        return asset;
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
  const people = await loadPeople(pak, save, texture, warnings, progress);
  const rulesBytes = await pak.readByName("floorplanrevealing.csv", { dir: "data\\floorplans\\" });
  const floorplanRules = rulesBytes ? parseFloorplanRevealing(new TextDecoder("latin1").decode(rulesBytes)) : null;
  const sky = await loadSky(pak, texture, warnings);
  return { sky, floorplanRules, people, camera, lot, terrain, meshes, placements, header: save.header, staff: save.staff, warnings };
}
