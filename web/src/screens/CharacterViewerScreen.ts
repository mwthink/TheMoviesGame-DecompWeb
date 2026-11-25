import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateLineSystem } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Scene } from "@babylonjs/core/scene";
import { PakIndex, type PakFile } from "../assets/Pak.ts";
import { BlobSource } from "../assets/ByteSource.ts";
import { decodeDds, type Rgba } from "../formats/Dds.ts";
import { anmDurationMs, anmFramePosition, parseAnm, type Anm } from "../formats/Anm.ts";
import { parseSave, type SavedPerson } from "../formats/Jad.ts";
import { clipFits, poseBones, skinTransforms } from "../sim/anim/AutoAnimation.ts";
import { ageYears } from "../sim/character/PersonModel.ts";
import { findTexture, PersonModelBuilder, type PersonModel } from "../world/WorldData.ts";
import { PersonMeshes } from "../world/PersonMeshes.ts";
import { sharedEngine } from "../world/sharedEngine.ts";
import { findGameArchives } from "./frontEndArt.ts";
import { mountScreen, unmountScreen, type Screen } from "./Screen.ts";

const DIR = { costumes: "data\\costume\\datas\\", heads: "data\\heads\\", meshes: "data\\meshes\\", clips: "data\\animations\\high\\" };
/** The clip the viewer starts with (and the fallback idle of people without a room scene). */
const DEFAULT_CLIP = "idle_male.anm";
/** At most this many clip names are listed at once; the filter narrows them. */
const MAX_CLIP_CHOICES = 300;

/**
 * The character viewer: look at any person the game can build. Pick a costume, head and hair (or a person from a saved game), set their age and weight, and
 * play any animation that fits the skeleton: orbit with the mouse, scrub the clip, switch textures, wireframe and back faces. A port of the standalone three.js viewer
 * (`viewer/index.html`) onto the app's own pipeline (`PersonModelBuilder`, `PersonMeshes`, docs/CHARACTER_VIEWER.md), so what it shows is what the world view draws.
 * Reads the player's own archives (nothing is stored); the face sliders of the editor (StarMaker) are not here yet.
 */
export class CharacterViewerScreen implements Screen {
  private el: HTMLElement | null = null;
  private scene: Scene | null = null;
  private camera: ArcRotateCamera | null = null;
  private pak: PakIndex | null = null;
  private builder: PersonModelBuilder | null = null;
  private model: PersonModel | null = null;
  private meshes: PersonMeshes | null = null;
  private clip: Anm | null = null;
  private clipName = "";
  private timeMs = 0;
  private playing = true;
  private speed = 1;
  private token = 0;
  private people: SavedPerson[] = [];
  private saveToday: number | undefined;
  private readonly textureCache = new Map<string, Promise<Rgba | null>>();
  private readonly onResize = () => sharedEngine(this.canvas).resize();
  private readonly onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && (e.target as HTMLElement).tagName !== "INPUT") this.onBack(); };

  constructor(private readonly container: HTMLElement, private readonly canvas: HTMLCanvasElement, private readonly onBack: () => void) {}

  enter(): void {
    this.el = mountScreen(this.container, "viewer");
    this.el.innerHTML = `
      <h3>Character viewer</h3>
      <p class="note" role="status">Looking for the game files</p>
      <div class="controls" hidden>
        <label>Costume <select data-f="cos"></select></label>
        <label>Head <select data-f="head"></select></label>
        <label>Hair <select data-f="hair"></select></label>
        <label>Age <input type="range" data-f="age" min="18" max="80" step="1" value="30"><output data-o="age"></output></label>
        <label>Weight <input type="range" data-f="weight" min="50" max="120" step="1" value="70"><output data-o="weight"></output></label>
        <label>Saved game <input type="file" data-f="save" accept=".jad"></label>
        <label data-people hidden>Person <select data-f="person"></select></label>
        <hr>
        <label>Find animation <input type="search" data-f="filter" placeholder="walk, idle, wave"></label>
        <label>Animation <select data-f="clip"></select></label>
        <label class="check"><input type="checkbox" data-f="play" checked> Play</label>
        <label>Speed <input type="range" data-f="speed" min="0.1" max="2" step="0.05" value="1"></label>
        <label>Time <input type="range" data-f="scrub" min="0" max="1" step="0.001" value="0"></label>
        <label class="check"><input type="checkbox" data-f="textured" checked> Textures</label>
        <label class="check"><input type="checkbox" data-f="wire"> Wireframe</label>
        <label class="check"><input type="checkbox" data-f="double"> Show back faces</label>
        <p class="info" data-info></p>
      </div>
      <div class="actions"><button type="button" data-back>Back</button></div>`;
    this.el.querySelector("[data-back]")!.addEventListener("click", () => this.onBack());
    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onKey);
    const engine = sharedEngine(this.canvas);
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.11, 0.12, 0.15, 1);
    // game (x, y, z up) -> Babylon (x, z, y): the model stands at the origin, facing the camera
    this.camera = new ArcRotateCamera("viewer", -Math.PI / 2.4, Math.PI / 2.2, 4.2, new Vector3(0, 0.95, 0), this.scene);
    this.camera.lowerRadiusLimit = 1;
    this.camera.upperRadiusLimit = 12;
    this.camera.wheelPrecision = 60;
    this.camera.minZ = 0.05;
    this.camera.attachControl(this.canvas, true);
    this.drawGrid(this.scene);
    let last = performance.now();
    engine.runRenderLoop(() => {
      const now = performance.now();
      this.tick(Math.min(now - last, 99));
      last = now;
      this.scene?.render();
    });
    engine.resize();
    void this.start();
  }

  exit(): void {
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKey);
    sharedEngine(this.canvas).stopRenderLoop();
    this.token++;
    this.meshes?.dispose();
    this.meshes = null;
    this.camera?.detachControl();
    this.scene?.dispose();
    this.scene = null;
    if (this.el) { void unmountScreen(this.el); this.el = null; }
  }

  private f<T extends HTMLElement>(name: string): T { return this.el!.querySelector<T>(`[data-f="${name}"]`)!; }

  private drawGrid(scene: Scene): void {
    const lines: Vector3[][] = [];
    for (let i = -3; i <= 3; i++) {
      lines.push([new Vector3(i, 0, -3), new Vector3(i, 0, 3)], [new Vector3(-3, 0, i), new Vector3(3, 0, i)]);
    }
    const grid = CreateLineSystem("grid", { lines }, scene);
    grid.color = new Color3(0.3, 0.32, 0.4);
    grid.isPickable = false;
  }

  /** Find the archives, list costumes, heads, hair and clips, then show a first person. */
  private async start(): Promise<void> {
    const el = this.el;
    if (!el) return;
    const paks = await findGameArchives();
    if (!this.el) return;
    const note = el.querySelector<HTMLElement>(".note")!;
    if (!paks.length) {
      note.textContent = "No game files found. Open Load Game once to pick your game folder (or run the dev server with OTM_GAME_DIR set).";
      return;
    }
    this.pak = await PakIndex.open(paks);
    const pak = this.pak;
    this.builder = new PersonModelBuilder(pak, (name) => this.texture(name));
    const names = (files: PakFile[], test: RegExp) => files.map((x) => x.entry.name).filter((n) => test.test(n));
    fill(this.f("cos"), names(pak.list(DIR.costumes), /\.cos$/i));
    fill(this.f("head"), ["(default for the costume)", ...names(pak.list(DIR.heads), /\.hd$/i)]);
    fill(this.f("hair"), ["(none)", ...names(pak.list(DIR.meshes), /^hair_.*\.msh$/i)]);
    this.f<HTMLSelectElement>("cos").value = pak.find("m_50s_2.cos") ? "m_50s_2.cos" : this.f<HTMLSelectElement>("cos").options[0]?.value ?? "";
    this.f<HTMLSelectElement>("hair").value = pak.find("hair_20s_m1.msh") ? "hair_20s_m1.msh" : "(none)";
    this.fillClips();
    note.textContent = `${this.f<HTMLSelectElement>("cos").options.length} costumes, ${this.f<HTMLSelectElement>("head").options.length - 1} heads. Drag to orbit, wheel to zoom.`;
    el.querySelector<HTMLElement>(".controls")!.hidden = false;
    this.wire();
    await this.rebuild();
  }

  private wire(): void {
    const rebuild = () => void this.rebuild();
    for (const name of ["cos", "head", "hair"]) this.f(name).addEventListener("change", rebuild);
    for (const name of ["age", "weight"]) this.f(name).addEventListener("change", rebuild);
    this.f("age").addEventListener("input", () => this.showNumbers());
    this.f("weight").addEventListener("input", () => this.showNumbers());
    this.f("filter").addEventListener("input", () => this.fillClips());
    this.f("clip").addEventListener("change", () => void this.chooseClip(this.f<HTMLSelectElement>("clip").value));
    this.f("play").addEventListener("change", () => { this.playing = this.f<HTMLInputElement>("play").checked; });
    this.f("speed").addEventListener("input", () => { this.speed = Number(this.f<HTMLInputElement>("speed").value); });
    this.f("scrub").addEventListener("input", () => {
      this.playing = false;
      this.f<HTMLInputElement>("play").checked = false;
      if (this.clip) this.timeMs = Number(this.f<HTMLInputElement>("scrub").value) * anmDurationMs(this.clip);
    });
    const look = () => this.meshes?.setLook({ wireframe: this.f<HTMLInputElement>("wire").checked, textured: this.f<HTMLInputElement>("textured").checked, doubleSided: this.f<HTMLInputElement>("double").checked });
    for (const name of ["textured", "wire", "double"]) this.f(name).addEventListener("change", look);
    this.f<HTMLInputElement>("save").addEventListener("change", () => void this.loadSave());
    this.f("person").addEventListener("change", () => this.pickPerson());
    this.showNumbers();
  }

  private showNumbers(): void {
    this.el!.querySelector('[data-o="age"]')!.textContent = `${this.f<HTMLInputElement>("age").value} years`;
    this.el!.querySelector('[data-o="weight"]')!.textContent = `${this.f<HTMLInputElement>("weight").value} kg`;
  }

  private texture(name: string): Promise<Rgba | null> {
    const key = name.toLowerCase();
    let t = this.textureCache.get(key);
    if (!t) {
      t = (async () => {
        const file = this.pak ? findTexture(this.pak, key) : undefined;
        return file ? decodeDds(await this.pak!.read(file)) : null;
      })();
      this.textureCache.set(key, t);
    }
    return t;
  }

  /** The animation names matching the filter (never more than `MAX_CLIP_CHOICES`); the current one stays listed. */
  private fillClips(): void {
    if (!this.pak) return;
    const q = this.f<HTMLInputElement>("filter").value.trim().toLowerCase();
    const all = this.pak.list(DIR.clips).map((x) => x.entry.name).filter((n) => /\.anm$/i.test(n));
    const shown = all.filter((n) => n.toLowerCase().includes(q)).slice(0, MAX_CLIP_CHOICES);
    if (this.clipName && !shown.includes(this.clipName)) shown.unshift(this.clipName);
    const sel = this.f<HTMLSelectElement>("clip");
    fill(sel, shown);
    sel.value = this.clipName && shown.includes(this.clipName) ? this.clipName : shown.includes(DEFAULT_CLIP) ? DEFAULT_CLIP : shown[0] ?? "";
    if (!this.clipName && sel.value) void this.chooseClip(sel.value);
  }

  private async chooseClip(name: string): Promise<void> {
    if (!this.pak || !name) return;
    const bytes = await this.pak.readByName(name, { dir: DIR.clips });
    const info = this.el?.querySelector<HTMLElement>("[data-info]");
    if (!bytes || !this.el) return;
    const clip = parseAnm(bytes);
    this.clipName = name;
    if (this.model && !clipFits(this.model.skeleton, clip)) {
      this.clip = null;
      if (info) info.textContent = `${name} has ${clip.nChannels} bones; this skeleton has ${this.model.skeleton.length}.`;
      return;
    }
    this.clip = clip;
    this.timeMs = 0;
    this.describe();
  }

  /** Make the person from the controls (a newer request cancels an older one still loading). */
  private async rebuild(): Promise<void> {
    if (!this.builder || !this.scene) return;
    const mine = ++this.token;
    const head = this.f<HTMLSelectElement>("head").value;
    const hair = this.f<HTMLSelectElement>("hair").value;
    const cos = this.f<HTMLSelectElement>("cos").value;
    try {
      const model = await this.builder.build({
        cos, head: head.startsWith("(") ? "" : head, hair: hair.startsWith("(") ? "" : hair,
        ageYears: Number(this.f<HTMLInputElement>("age").value), weightKg: Number(this.f<HTMLInputElement>("weight").value),
      });
      if (mine !== this.token || !this.scene) return;
      this.meshes?.dispose();
      this.model = model;
      this.meshes = new PersonMeshes(this.scene, { bind: model.parts, textures: model.textures, skeleton: model.skeleton }, "viewer/person", new Map<string, StandardMaterial>());
      this.meshes.setLook({ wireframe: this.f<HTMLInputElement>("wire").checked, textured: this.f<HTMLInputElement>("textured").checked, doubleSided: this.f<HTMLInputElement>("double").checked });
      if (this.clipName) await this.chooseClip(this.clipName);
      else this.describe();
    } catch (e) {
      const info = this.el?.querySelector<HTMLElement>("[data-info]");
      if (info) info.textContent = e instanceof Error ? e.message : String(e);
    }
  }

  private describe(): void {
    const info = this.el?.querySelector<HTMLElement>("[data-info]");
    if (!info || !this.model) return;
    const verts = this.model.parts.reduce((n, p) => n + p.positions.length / 3, 0);
    info.textContent = `${verts} vertices, ${this.model.parts.length} parts, ${this.model.skeleton.length} bones` + (this.clip ? `; ${this.clipName}: ${this.clip.nFrames} frames, ${(anmDurationMs(this.clip) / 1000).toFixed(2)} s` : "");
  }

  /** Per frame: advance the clip and re-skin. */
  private tick(dtMs: number): void {
    if (!this.model || !this.meshes || !this.clip) return;
    const dur = anmDurationMs(this.clip);
    if (this.playing) {
      this.timeMs = (this.timeMs + dtMs * this.speed) % dur;
      this.f<HTMLInputElement>("scrub").value = String(this.timeMs / dur);
    }
    const sk = this.model.skeleton;
    this.meshes.applyPose(skinTransforms(sk, poseBones(sk, this.clip, anmFramePosition(this.clip, this.timeMs), "absolute")));
  }

  /** Pick a saved game and list its people; choosing one fills in the controls from the save (costume, head, hair, age, weight). */
  private async loadSave(): Promise<void> {
    const file = this.f<HTMLInputElement>("save").files?.[0];
    if (!file) return;
    const src = new BlobSource(file.name, file);
    const save = parseSave(await src.read(0, src.size));
    this.saveToday = save.header?.date;
    this.people = save.people.filter((p) => p.costume?.cos);
    const sel = this.f<HTMLSelectElement>("person");
    sel.textContent = "";
    this.people.forEach((p, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = `${p.name || `#${p.id}`} (${p.cls.replace("C", "").toLowerCase()})`;
      sel.append(o);
    });
    this.el!.querySelector<HTMLElement>("[data-people]")!.hidden = !this.people.length;
    if (this.people.length) this.pickPerson();
  }

  private pickPerson(): void {
    const p = this.people[Number(this.f<HTMLSelectElement>("person").value)];
    if (!p?.costume) return;
    const set = (name: string, value: string) => { const sel = this.f<HTMLSelectElement>(name); if ([...sel.options].some((o) => o.value === value)) sel.value = value; };
    set("cos", p.costume.cos);
    set("head", p.head || "(default for the costume)");
    set("hair", p.costume.hair || "(none)");
    this.f<HTMLInputElement>("age").value = String(Math.round(Math.min(80, Math.max(18, ageYears(p.birth, this.saveToday)))));
    this.f<HTMLInputElement>("weight").value = String(Math.round(Math.min(120, Math.max(50, p.weight > 0 ? p.weight : 70))));
    this.showNumbers();
    void this.rebuild();
  }
}

/** Replace a select's options with these values. */
function fill(sel: HTMLSelectElement, values: string[]): void {
  sel.textContent = "";
  for (const v of values) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    sel.append(o);
  }
}
