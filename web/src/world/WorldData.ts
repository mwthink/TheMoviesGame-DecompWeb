import { parseTimelineEvents, type TimelineEvent } from "../sim/audio/RadioSpeech.ts";
import type { PakIndex } from "../assets/Pak.ts";
import { decodeDds, type Rgba } from "../formats/Dds.ts";
import { Ini } from "../formats/Ini.ts";
import type { Landscape, PlacedAsset, Save, SaveHeader, SavedPerson, SavedStaff } from "../formats/Jad.ts";
import { parseCos } from "../formats/Cos.ts";
import { compositeLayers, isAlphaMap, variantOf, withVariant } from "../sim/character/CostumeLayers.ts";
import { firstAnimation, parseFlm } from "../formats/Flm.ts";
import { parseFloorplanRevealing, type RevealRules } from "../sim/ui/FloorplanReveal.ts";
import { parseSeq } from "../formats/Seq.ts";
import { FALLBACK_CLIP, type AnimationPlan } from "../sim/anim/PersonAnimation.ts";
import { defaultGaits, gaitClipFile, parseGaitIni } from "../sim/anim/Gaits.ts";
import { NavGrid, type Point } from "../sim/nav/NavGrid.ts";
import { loadPropData } from "./Props.ts";
import type { PropExplainer } from "../sim/ai/Explainers.ts";
import type { DesireDef } from "../sim/ai/Desires.ts";
import type { MshBone } from "../formats/Msh.ts";
import { parseHead, type HeadFile } from "../sim/character/HeadFile.ts";
import { ageYears, defaultHeadFor, meshParts, morphedHead, poseParts, STANDING_POSE_CLIP, type ModelPart } from "../sim/character/PersonModel.ts";
import { anmSpeed, parseAnm, type Anm } from "../formats/Anm.ts";
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

/**
 * The gait clips of a person (docs/MOVEMENT.md): the stroll, walk and run of `defaultGaits` for their sex, looked up in `gait.ini` (a built-in list when the archives lack it), loaded into
 * `clips`; and how fast each moves them. A clip that cannot be loaded gives speed 0 for that gait.
 */
async function loadGaits(
  pak: PakIndex, person: SavedPerson, clip: (name: string) => Promise<Anm | null>, clips: Map<string, Anm>, skeleton: MshBone[],
): Promise<PersonInWorld["gaits"]> {
  const fallbackFiles = ["walk.anm", "walk.anm", "run_jog.anm"];
  const femaleFallback = ["walk_female_middle.anm", "walk_female.anm", "run_f_jog.anm"];
  const bytes = await pak.readByName("gait.ini");
  const ini = bytes ? parseGaitIni(new TextDecoder("latin1").decode(bytes)) : null;
  const female = (person.costume?.cos ?? "").toLowerCase().startsWith("f_");
  const ids = defaultGaits(female);
  const wanted = [ids.stroll, ids.walk, ids.run];
  const files = wanted.map((id, i) => (ini && gaitClipFile(ini, id)) || (female ? femaleFallback : fallbackFiles)[i]!) as [string, string, string];
  const speeds: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    let c = clips.get(files[i]!);
    if (!c) {
      const loaded = await clip(files[i]!);
      if (loaded && clipFits(skeleton, loaded)) { clips.set(files[i]!, loaded); c = loaded; }
    }
    speeds[i] = c ? anmSpeed(c) : 0;
  }
  // some female gait clips hold no frames (walk_female.anm, walk_female_2.anm, walk_fem_bored.anm): take the speed and clip of a working neighbour
  for (let i = 0; i < 3; i++) {
    if (speeds[i]! > 0) continue;
    const j = [0, 1, 2].filter((k) => speeds[k]! > 0).sort((a, b) => Math.abs(a - i) - Math.abs(b - i))[0];
    if (j !== undefined) { speeds[i] = speeds[j]!; files[i] = files[j]!; }
    else speeds[i] = [0.9, 1.67, 3.16][i]!;
  }
  return { files, speeds };
}

/**
 * The walking grid: the lot's rectangle is walkable except where a placed model's footprint (`b15_02`, the polygon the placement code keeps clear, `SAVE_FORMAT.md`) lies, turned by
 * the placement's angle and moved to its position. People outside the lot are not covered (the lot's walls and gate keep them in).
 */
function buildNav(lot: WorldData["lot"], placements: Placement[]): NavGrid {
  const nav = new NavGrid();
  if (lot) nav.openRect(lot.bounds.minX, lot.bounds.minY, lot.bounds.maxX, lot.bounds.maxY);
  else nav.openRect(-190, -126, 190, 254);
  for (const p of placements) {
    const fp = p.mesh.msh.chunks.b15_02;
    if (!fp || !fp.tris.length) continue;
    const [px, py] = p.asset.position;
    const c = Math.cos(p.asset.angle), s = Math.sin(p.asset.angle), k = p.scale ?? 1;
    const world = (i: number): Point => {
      const x = fp.verts[i * 3]! * k, y = fp.verts[i * 3 + 1]! * k;
      return { x: px + x * c - y * s, y: py + x * s + y * c };
    };
    const tris: [Point, Point, Point][] = [];
    for (let t = 0; t < fp.tris.length; t += 3) tris.push([world(fp.tris[t]!), world(fp.tris[t + 1]!), world(fp.tris[t + 2]!)]);
    nav.blockTriangles(tris);
  }
  return nav;
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
  /** Costume looks (docs/CHARACTER_VIEWER.md). Without them the body is drawn with its own atlas and no accessories, as in the world view. */
  look?: CostumeLook;
}

/**
 * Choices of a costume's variable parts, by position in the `.cos` (`Cos.textures`, `Cos.meshes`). A texture layer's number picks `_vNN`; an entry not given keeps
 * the file's own variant. An accessory is left out unless it is given a variant number.
 */
export interface CostumeLook {
  layers?: Record<number, number>;
  accessories?: Record<number, number>;
}

/** What can be changed in a costume: its variable texture layers and accessories, with how many variants each has and which the `.cos` names. */
export interface CostumeOptions {
  layers: { index: number; slot: string; file: string; variants: number[]; current: number }[];
  accessories: { index: number; slot: string; file: string; variants: number[]; current: number }[];
}

/** A person's model in the bind pose: body, head and hair parts, the skeleton they share and the textures they use. */
export interface PersonModel {
  parts: (ModelPart & { cutout: boolean })[];
  skeleton: MshBone[];
  textures: Map<string, Rgba>;
}

/** The most variant numbers looked for per layer. */
const MAX_VARIANTS = 40;

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

  /** The variable layers and accessories of a costume and the variant numbers that exist in the archives (at most `MAX_VARIANTS` are looked for). */
  async costumeOptions(cosName: string): Promise<CostumeOptions> {
    const bytes = await this.pak.readByName(cosName);
    if (!bytes) throw new Error(`no ${cosName}`);
    const cos = parseCos(bytes);
    const list = (recs: { file: string; slot: string }[], exists: (file: string) => boolean, skip: (file: string) => boolean) => {
      const out: CostumeOptions["layers"] = [];
      recs.forEach((r, index) => {
        const current = variantOf(r.file);
        if (current === undefined || skip(r.file)) return;
        const variants: number[] = [];
        for (let v = 0; v < MAX_VARIANTS; v++) if (exists(withVariant(r.file, v))) variants.push(v);
        if (variants.length) out.push({ index, slot: r.slot, file: r.file, variants, current });
      });
      return out;
    };
    return {
      layers: list(cos.textures, (f) => findTexture(this.pak, f) !== undefined, isAlphaMap),
      accessories: list(cos.meshes, (f) => this.pak.find(f) !== undefined, () => false),
    };
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
    const look = spec.look;
    const extra = new Map<string, Rgba>();
    if (look?.layers && Object.keys(look.layers).length) {
      const bodyKey = parts[0]?.texture.toLowerCase() ?? "";
      const atlas = bodyKey ? await this.texture(bodyKey) : null;
      if (atlas) {
        const layers: Rgba[] = [];
        for (let i = 0; i < cos.textures.length; i++) {
          const rec = cos.textures[i]!;
          if (isAlphaMap(rec.file) || variantOf(rec.file) === undefined) continue;
          const img = await this.texture(withVariant(rec.file, look.layers[i] ?? variantOf(rec.file)!));
          if (img) layers.push(img);
        }
        const name = `${bodyKey}+${Object.entries(look.layers).map(([i, v]) => `${i}:${v}`).join(",")}`;
        extra.set(name, compositeLayers(atlas, layers));
        for (const p of parts) if (p.texture.toLowerCase() === bodyKey) p.texture = name;
      }
    }
    const headBone = body.skeleton.findIndex((b) => b.name.toLowerCase() === "head");
    for (const [i, v] of Object.entries(look?.accessories ?? {})) {
      const rec = cos.meshes[Number(i)];
      if (!rec) continue;
      const acc = await this.msh(variantOf(rec.file) === undefined ? rec.file : withVariant(rec.file, v));
      if (!acc) { warn(`no accessory ${rec.file}`); continue; }
      for (const p of meshParts(acc)) {
        // a static accessory (a hat) follows the head
        const n = p.positions.length / 3;
        const skin = p.skin ?? (headBone >= 0 ? { weights: new Float32Array(n * 4).map((_, k) => (k % 4 === 0 ? 1 : 0)), bones: new Uint8Array(n * 4).map((_, k) => (k % 4 === 0 ? headBone : 0)) } : null);
        parts.push({ ...p, skin, cutout: true });
      }
    }
    const textures = new Map<string, Rgba>(extra);
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
      const gaits = await loadGaits(pak, person, clip, clips, body.skeleton);
      out.push({
        person, bind: parts, skeleton: body.skeleton, plan, clips, textures, gaits, outdoors: !plan || plan.source.startsWith("fallback"),
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
  /** The clip files of the person's stroll, walk and run gaits (loaded into `clips`) and how fast each moves them, in units per second. */
  gaits: { files: [string, string, string]; speeds: [number, number, number] };
  /** Free to wander: not busy in a room (outside, or in a room with no scene). */
  outdoors: boolean;
}

/** The game's sky box (`Sky_box.msh`, docs/SKY.md): its model and the textures of every sky variant. */
export interface SkyData {
  msh: Msh;
  /** Decoded textures by lower-case file name, including every `sky_NN_v00/v01/v02` variant of the four sky walls. */
  textures: Map<string, Rgba>;
}

export interface WorldData {
  /** Where people can walk: the lot's area minus the footprints of what is placed on it (`sim/nav/NavGrid.ts`, docs/MOVEMENT.md). */
  nav: NavGrid;
  /** What the placed props offer people, and the desire table (`world/Props.ts`, docs/DESIRES.md). */
  props: PropExplainer[];
  desires: Map<string, DesireDef>;
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
  /** The timeline's historical events (`data\\rule\\timeline.csv`): the radio reads news about them. Empty if the archives lack the file. */
  timelineEvents: TimelineEvent[];
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
  const nav = buildNav(lot, placements);
  const { props, desires } = await loadPropData(pak, placements, warnings);
  // outdoors: no room scene and standing on open ground (the others stay where their scene put them until sent somewhere)
  for (const p of people) p.outdoors = p.outdoors && !nav.isBlocked(p.person.position[0], p.person.position[1]);
  let timelineEvents: TimelineEvent[] = [];
  try {
    const csv = await pak.readByName("timeline.csv");
    if (csv) timelineEvents = parseTimelineEvents(new TextDecoder("latin1").decode(csv));
  } catch { /* the radio just has no news */ }
  return { nav, props, desires, sky, floorplanRules, people, camera, lot, terrain, meshes, placements, header: save.header, staff: save.staff, timelineEvents, warnings };
}
