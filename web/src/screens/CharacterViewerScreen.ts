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
import { STANDING_POSE_CLIP } from "../sim/character/PersonModel.ts";
import { clipFits, poseBones, skinTransforms } from "../sim/anim/AutoAnimation.ts";
import { decodeCharacter, encodeCharacter, type CharacterLook } from "../sim/character/CharacterCode.ts";
import { ageYears } from "../sim/character/PersonModel.ts";
import { findTexture, PersonModelBuilder, type CostumeLook, type CostumeOptions, type PersonModel } from "../world/WorldData.ts";
import { PersonMeshes } from "../world/PersonMeshes.ts";
import { sharedEngine } from "../world/sharedEngine.ts";
import { findGameArchives } from "./frontEndArt.ts";
import { LoadingSceneEditor, type SceneSource } from "./LoadingSceneEditor.ts";
import { mountScreen, unmountScreen, type Screen } from "./Screen.ts";

const DIR = { costumes: "data\\costume\\datas\\", heads: "data\\heads\\", meshes: "data\\meshes\\", clips: "data\\animations\\high\\" };
/** The clip the viewer starts with (and the fallback idle of people without a room scene). */
/** The Head choice that leaves the generic head off (a body that has its own). */
const NO_HEAD = "(no head)";
const DEFAULT_CLIP = STANDING_POSE_CLIP;
/** At most this many clip names are listed at once; the filter narrows them. */
const MAX_CLIP_CHOICES = 300;
/** Where the viewer remembers its last person and clip (this browser only; names of game files, nothing from inside them). */
const STORE_KEY = "otm.characterViewer";
/** The camera the viewer starts with (and goes back to on reset). */
const CAMERA_HOME = { alpha: -Math.PI / 2.4, beta: Math.PI / 2.2, radius: 4.2, target: new Vector3(0, 0.95, 0) };
/** One sampled frame of a clip (`anmDurationMs`: 100 ms per frame). */
const FRAME_MS = 100;
/** Auto-orbit speed, radians per second. */
const ORBIT_SPEED = 0.5;

/** What the viewer remembers between visits. */
interface Remembered { cos?: string; head?: string; hair?: string; age?: number; weight?: number; look?: CostumeLook; clip?: string; filter?: string }

/** The keys of the viewer, shown in its help list. */
const KEYS: [string, string][] = [
  ["↑ ↓", "costume"], ["⇧ ↑ ↓", "head"], ["← →", "animation"], ["⇧ ← →", "hair"],
  ["Space", "play / pause"], [", .", "step a frame"], ["[ ]", "slower / faster"], ["R", "random person"],
  ["O", "auto-orbit"], ["C", "reset camera"], ["T W B", "textures, wireframe, back faces"], ["/", "find animation"],
  ["?", "this list"], ["Esc", "leave a field, then back"],
];

/**
 * The character viewer: look at any person the game can build. Pick a costume, head and hair (or a person from a saved game), set their age and weight, and
 * play any animation that fits the skeleton: orbit with the mouse, scrub the clip, switch textures, wireframe and back faces. A port of the standalone three.js viewer
 * (`viewer/index.html`) onto the app's own pipeline (`PersonModelBuilder`, `PersonMeshes`, docs/CHARACTER_VIEWER.md), so what it shows is what the world view draws.
 * Reads the player's own archives (nothing from them is stored; the last person and clip chosen are remembered by name in this browser); the keys are in `KEYS`; the face sliders of the editor (StarMaker) are not here yet.
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
  /** The variable parts of the chosen costume and what is picked for them (empty = the costume's own). */
  private options: CostumeOptions = { layers: [], accessories: [] };
  private look: CostumeLook = {};
  private optionsFor = "";
  /** Variant choices from a pasted character, applied when the costume's options have been read. */
  private pending: CostumeLook | null = null;
  private readonly textureCache = new Map<string, Promise<Rgba | null>>();
  private readonly onResize = () => sharedEngine(this.canvas).resize();
  private clipToken = 0;
  private orbit = false;
  /** Set by Random: the next costume's layers and accessories are picked at random once its options are read. */
  private randomLook = false;
  private sceneEditor: LoadingSceneEditor | null = null;
  private readonly onKey = (e: KeyboardEvent) => this.key(e);
  private readonly onCanvasDown = () => { const a = document.activeElement as HTMLElement | null; if (a && a !== document.body) a.blur(); };

  constructor(private readonly container: HTMLElement, private readonly canvas: HTMLCanvasElement, private readonly onBack: () => void) {}

  enter(): void {
    this.el = mountScreen(this.container, "viewer");
    this.el.innerHTML = `
      <h3>Character viewer</h3>
      <p class="note" role="status">Looking for the game files</p>
      <div class="controls" hidden>
        ${pickHtml("Costume", 'data-f="cos"')}
        <div data-costume></div>
        ${pickHtml("Head", 'data-f="head"')}
        ${pickHtml("Hair", 'data-f="hair"')}
        <label>Age <input type="range" data-f="age" min="18" max="80" step="1" value="30"><output data-o="age"></output></label>
        <label>Weight <input type="range" data-f="weight" min="50" max="120" step="1" value="70"><output data-o="weight"></output></label>
        <div class="actions"><button type="button" data-random title="R">Random person</button> <button type="button" data-reset-defaults>Reset to defaults</button></div>
        <div class="actions"><button type="button" data-copy-to>Copy character to clipboard</button> <button type="button" data-copy-from>Copy character from clipboard</button></div>
        <label>Saved game <input type="file" data-f="save" accept=".jad"></label>
        <div data-people hidden>${pickHtml("Person", 'data-f="person"')}</div>
        <hr>
        <label>Find animation <input type="search" data-f="filter" placeholder="walk, idle, wave"></label>
        ${pickHtml("Animation", 'data-f="clip"')}
        <label class="check"><input type="checkbox" data-f="play" checked> Play</label>
        <label>Speed <input type="range" data-f="speed" min="0.1" max="2" step="0.05" value="1"></label>
        <label>Time <input type="range" data-f="scrub" min="0" max="1" step="0.001" value="0"></label>
        <label class="check"><input type="checkbox" data-f="textured" checked> Textures</label>
        <label class="check"><input type="checkbox" data-f="wire"> Wireframe</label>
        <label class="check"><input type="checkbox" data-f="double"> Show back faces</label>
        <label class="check"><input type="checkbox" data-f="orbit"> Auto-orbit</label>
        <div class="actions"><button type="button" data-home title="C">Reset camera</button></div>
        <details data-scene><summary>Loading scene</summary><div data-scene-body></div></details>
        <p class="info" data-info></p>
        <p class="info" data-frame></p>
        <details data-keys><summary>Keys</summary><dl class="keys">${KEYS.map(([k, what]) => `<dt>${k}</dt><dd>${what}</dd>`).join("")}</dl></details>
      </div>
      <div class="actions"><button type="button" data-back>Back</button></div>`;
    this.el.querySelector("[data-back]")!.addEventListener("click", () => this.onBack());
    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onKey);
    this.canvas.addEventListener("pointerdown", this.onCanvasDown);
    const engine = sharedEngine(this.canvas);
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.11, 0.12, 0.15, 1);
    // game (x, y, z up) -> Babylon (x, z, y): the model stands at the origin, facing the camera
    this.camera = new ArcRotateCamera("viewer", CAMERA_HOME.alpha, CAMERA_HOME.beta, CAMERA_HOME.radius, CAMERA_HOME.target.clone(), this.scene);
    // the arrow keys belong to the viewer's own lists, not to the camera
    this.camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");
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
    this.sceneEditor?.dispose();
    this.sceneEditor = null;
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKey);
    this.canvas.removeEventListener("pointerdown", this.onCanvasDown);
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
    fill(this.f("head"), ["(default for the costume)", NO_HEAD, ...names(pak.list(DIR.heads), /\.hd$/i)]);
    fill(this.f("hair"), ["(none)", ...names(pak.list(DIR.meshes), /^hair_.*\.msh$/i)]);
    this.applyDefaultPerson();
    this.restore();
    this.fillClips();
    note.textContent = `${this.f<HTMLSelectElement>("cos").options.length} costumes, ${this.f<HTMLSelectElement>("head").options.length - 2} heads. Drag to orbit, wheel to zoom.`;
    el.querySelector<HTMLElement>(".controls")!.hidden = false;
    this.wire();
    const editor = new LoadingSceneEditor(this.container, () => this.pak, () => this.sceneSource(), (t) => this.say(t));
    const body = el.querySelector<HTMLElement>("[data-scene-body]")!;
    body.innerHTML = editor.html();
    editor.wire(body);
    this.sceneEditor = editor;
    await this.rebuild();
  }

  /** The person the viewer opens with: the default costume and hair, the default head, age and weight. */
  private applyDefaultPerson(): void {
    const pak = this.pak!;
    this.f<HTMLSelectElement>("cos").value = pak.find("m_50s_2.cos") ? "m_50s_2.cos" : this.f<HTMLSelectElement>("cos").options[0]?.value ?? "";
    this.f<HTMLSelectElement>("head").selectedIndex = 0;
    this.f<HTMLSelectElement>("hair").value = pak.find("hair_20s_m1.msh") ? "hair_20s_m1.msh" : "(none)";
    this.f<HTMLInputElement>("age").value = "30";
    this.f<HTMLInputElement>("weight").value = "70";
  }

  /** Back to how the first visit looks: default person, the standing pose held at frame 0, default switches and camera; the remembered state is cleared. */
  private async resetToDefaults(): Promise<void> {
    if (!this.pak) return;
    try { localStorage.removeItem(STORE_KEY); } catch { /* storage off: nothing to clear */ }
    this.applyDefaultPerson();
    this.look = {};
    this.pending = null;
    this.randomLook = false;
    this.optionsFor = ""; // read the costume's options again, with none of its variants or accessories chosen
    this.clipName = "";
    this.f<HTMLInputElement>("filter").value = "";
    this.f<HTMLInputElement>("speed").value = "1";
    this.speed = 1;
    for (const [name, on] of [["textured", true], ["wire", false], ["double", false], ["orbit", false]] as const) this.f<HTMLInputElement>(name).checked = on;
    this.orbit = false;
    this.playing = true;
    this.f<HTMLInputElement>("play").checked = true;
    this.showNumbers();
    this.resetCamera();
    this.fillClips(); // with no clip chosen this picks the default one and holds it at frame 0
    await this.rebuild();
  }

  private wire(): void {
    const rebuild = () => void this.rebuild();
    this.f("cos").addEventListener("change", () => void this.rebuild());
    for (const name of ["head", "hair"]) this.f(name).addEventListener("change", rebuild);
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
    this.el!.querySelector("[data-reset-defaults]")!.addEventListener("click", () => void this.resetToDefaults());
    this.el!.querySelector("[data-copy-to]")!.addEventListener("click", () => void this.copyTo());
    this.el!.querySelector("[data-copy-from]")!.addEventListener("click", () => void this.copyFrom());
    this.f<HTMLInputElement>("save").addEventListener("change", () => void this.loadSave());
    this.f("person").addEventListener("change", () => this.pickPerson());
    this.f("orbit").addEventListener("change", () => { this.orbit = this.f<HTMLInputElement>("orbit").checked; });
    this.el!.querySelector("[data-random]")!.addEventListener("click", () => this.randomize());
    this.el!.querySelector("[data-home]")!.addEventListener("click", () => this.resetCamera());
    // the < > buttons beside each list: step it and leave the focus on the list, so the arrow keys go on from there
    this.el!.addEventListener("mousedown", (e) => { if ((e.target as HTMLElement).closest("[data-step]")) e.preventDefault(); });
    this.el!.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-step]");
      const sel = btn?.closest(".pick")?.querySelector("select");
      if (!btn || !sel) return;
      stepSelect(sel, Number(btn.dataset.step));
      sel.focus();
    });
    this.el!.addEventListener("change", () => this.showCounts());
    this.showNumbers();
    this.showCounts();
  }

  /** "12 / 400" beside each list. */
  private showCounts(): void {
    for (const pick of this.el?.querySelectorAll<HTMLElement>(".pick") ?? []) {
      const sel = pick.querySelector("select"), out = pick.querySelector("output");
      if (sel && out) out.textContent = sel.options.length ? `${sel.selectedIndex + 1} / ${sel.options.length}` : "";
    }
  }

  /** The window's keys: a focused list steps with the arrows; otherwise the arrows step the costume and the animation (see `KEYS`). */
  private key(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey || !this.el) return;
    const t = e.target as HTMLElement;
    if (t instanceof HTMLSelectElement) {
      const n = t.options.length;
      const to: Record<string, number> = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1, PageUp: -10, PageDown: 10 };
      if (e.key in to) stepSelect(t, to[e.key]!);
      else if (e.key === "Home") setIndex(t, 0);
      else if (e.key === "End") setIndex(t, n - 1);
      else if (e.key === "Escape") t.blur();
      else return; // letters: the list's own type-to-find
      e.preventDefault();
      return;
    }
    if (t instanceof HTMLInputElement) {
      if (t.dataset.f === "filter") {
        // the find box drives the animation list without leaving it
        if (e.key === "ArrowUp" || e.key === "ArrowDown") stepSelect(this.f("clip"), e.key === "ArrowUp" ? -1 : 1);
        else if (e.key === "Enter") t.blur();
        else if (e.key === "Escape") { if (t.value) { t.value = ""; this.fillClips(); } else t.blur(); }
        else return;
        e.preventDefault();
        return;
      }
      if (t.type === "text" || t.type === "search" || t.type === "number") return;
      if (e.key === "Escape") { t.blur(); e.preventDefault(); return; }
      // a slider keeps its arrows, a checkbox its space, the file picker its enter
      if (e.key === " " || e.key === "Enter" || (t.type === "range" && e.key.startsWith("Arrow"))) return;
    } else if (t instanceof HTMLTextAreaElement) {
      return;
    } else if (t instanceof HTMLButtonElement || t instanceof HTMLElement && t.tagName === "SUMMARY") {
      if (e.key === " " || e.key === "Enter") return;
      if (e.key === "Escape") { t.blur(); e.preventDefault(); return; }
    }
    if (this.shortcut(e)) e.preventDefault();
  }

  private shortcut(e: KeyboardEvent): boolean {
    const toggle = (name: string) => { const box = this.f<HTMLInputElement>(name); box.checked = !box.checked; box.dispatchEvent(new Event("change", { bubbles: true })); };
    switch (e.key) {
      case "ArrowUp": case "ArrowDown": stepSelect(this.f(e.shiftKey ? "head" : "cos"), e.key === "ArrowUp" ? -1 : 1); return true;
      case "ArrowLeft": case "ArrowRight": stepSelect(this.f(e.shiftKey ? "hair" : "clip"), e.key === "ArrowLeft" ? -1 : 1); return true;
      case " ": toggle("play"); return true;
      case ",": case ".": this.stepFrame(e.key === "," ? -1 : 1); return true;
      case "[": case "]": {
        const s = this.f<HTMLInputElement>("speed");
        s.value = String(Number(s.value) * (e.key === "[" ? 0.8 : 1.25));
        s.dispatchEvent(new Event("input"));
        return true;
      }
      case "?": { const d = this.el!.querySelector<HTMLDetailsElement>("[data-keys]")!; d.open = !d.open; return true; }
      case "/": this.f<HTMLInputElement>("filter").focus(); this.f<HTMLInputElement>("filter").select(); return true;
      case "Escape": this.onBack(); return true;
    }
    switch (e.key.toLowerCase()) {
      case "r": this.randomize(); return true;
      case "o": toggle("orbit"); return true;
      case "c": this.resetCamera(); return true;
      case "t": toggle("textured"); return true;
      case "w": toggle("wire"); return true;
      case "b": toggle("double"); return true;
    }
    return false;
  }

  /** Pause and move one sampled frame on or back. */
  private stepFrame(dir: number): void {
    if (!this.clip) return;
    this.playing = false;
    this.f<HTMLInputElement>("play").checked = false;
    const dur = anmDurationMs(this.clip);
    this.timeMs = ((Math.round(this.timeMs / FRAME_MS) + dir) * FRAME_MS % dur + dur) % dur;
    this.f<HTMLInputElement>("scrub").value = String(this.timeMs / dur);
  }

  private resetCamera(): void {
    const c = this.camera;
    if (!c) return;
    c.alpha = CAMERA_HOME.alpha;
    c.beta = CAMERA_HOME.beta;
    c.radius = CAMERA_HOME.radius;
    c.setTarget(CAMERA_HOME.target.clone());
  }

  /**
   * A random person: a costume, then a head and hair of the costume's sex (the `m_` / `f_` prefix of the names), an age and weight, and random layer and accessory
   * variants once the costume's options are read.
   */
  private randomize(): void {
    const any = <T>(xs: T[]): T | undefined => xs[Math.floor(Math.random() * xs.length)];
    const values = (name: string) => [...this.f<HTMLSelectElement>(name).options].map((o) => o.value);
    const cos = any(values("cos"));
    if (!cos) return;
    this.f<HTMLSelectElement>("cos").value = cos;
    const sex = /^([mf])_/i.exec(cos)?.[1]?.toLowerCase();
    const heads = values("head").filter((h) => sex && h.toLowerCase().startsWith(`head_${sex}_`));
    this.f<HTMLSelectElement>("head").value = any(heads) ?? "(default for the costume)";
    const hairs = values("hair").filter((h) => sex && new RegExp(`_${sex}\\d`, "i").test(h));
    this.f<HTMLSelectElement>("hair").value = any(hairs) ?? "(none)";
    this.f<HTMLInputElement>("age").value = String(18 + Math.floor(Math.random() * 55));
    this.f<HTMLInputElement>("weight").value = String(52 + Math.floor(Math.random() * 50));
    this.showNumbers();
    this.showCounts();
    this.randomLook = true;
    this.optionsFor = "";
    void this.rebuild();
  }

  /** Put back the person and clip of the last visit (each only if this game has it). */
  private restore(): void {
    let r: Remembered;
    try { r = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Remembered; } catch { return; }
    const set = (name: string, value: string | undefined) => {
      const sel = this.f<HTMLSelectElement>(name);
      if (value && [...sel.options].some((o) => o.value === value)) sel.value = value;
    };
    set("cos", r.cos);
    set("head", r.head);
    set("hair", r.hair);
    if (typeof r.age === "number") this.f<HTMLInputElement>("age").value = String(r.age);
    if (typeof r.weight === "number") this.f<HTMLInputElement>("weight").value = String(r.weight);
    if (r.look && r.cos === this.f<HTMLSelectElement>("cos").value) this.pending = r.look;
    if (typeof r.filter === "string") this.f<HTMLInputElement>("filter").value = r.filter;
    if (r.clip && this.pak?.list(DIR.clips).some((x) => x.entry.name === r.clip)) this.clipName = r.clip;
  }

  private remember(): void {
    if (!this.el) return;
    const r: Remembered = {
      cos: this.f<HTMLSelectElement>("cos").value, head: this.f<HTMLSelectElement>("head").value, hair: this.f<HTMLSelectElement>("hair").value,
      age: Number(this.f<HTMLInputElement>("age").value), weight: Number(this.f<HTMLInputElement>("weight").value),
      look: this.look, clip: this.clipName, filter: this.f<HTMLInputElement>("filter").value,
    };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(r)); } catch { /* storage full or off: nothing remembered */ }
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
    if (!this.clipName && sel.value) {
      // first visit: the pose people are drawn in (frame 0 of the standing clip), held rather than played
      if (sel.value === STANDING_POSE_CLIP) { this.playing = false; this.f<HTMLInputElement>("play").checked = false; }
      void this.chooseClip(sel.value);
    }
    this.showCounts();
  }

  private async chooseClip(name: string): Promise<void> {
    if (!this.pak || !name) return;
    const mine = ++this.clipToken;
    const bytes = await this.pak.readByName(name, { dir: DIR.clips });
    const info = this.el?.querySelector<HTMLElement>("[data-info]");
    if (!bytes || !this.el || mine !== this.clipToken) return;
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
    this.remember();
  }

  /** Make the person from the controls (a newer request cancels an older one still loading). */
  private async rebuild(): Promise<void> {
    if (!this.builder || !this.scene) return;
    const mine = ++this.token;
    this.showCounts();
    const head = this.f<HTMLSelectElement>("head").value;
    const hair = this.f<HTMLSelectElement>("hair").value;
    const cos = this.f<HTMLSelectElement>("cos").value;
    try {
      if (cos !== this.optionsFor) {
        // a new costume: its own variants, and no accessories until one is asked for
        this.optionsFor = cos;
        this.look = this.pending ?? {};
        this.pending = null;
        this.options = await this.builder.costumeOptions(cos);
        if (mine !== this.token) return;
        if (this.randomLook) { this.look = randomLook(this.options); this.randomLook = false; }
        this.showCostumeOptions();
      }
      const model = await this.builder.build({
        cos, head: head.startsWith("(") ? "" : head, noHead: head === NO_HEAD ? true : undefined, hair: hair.startsWith("(") ? "" : hair,
        ageYears: Number(this.f<HTMLInputElement>("age").value), weightKg: Number(this.f<HTMLInputElement>("weight").value),
        look: this.look,
      });
      if (mine !== this.token || !this.scene) return;
      this.meshes?.dispose();
      this.model = model;
      this.meshes = new PersonMeshes(this.scene, { bind: model.parts, textures: model.textures, skeleton: model.skeleton }, "viewer/person", new Map<string, StandardMaterial>());
      this.meshes.setLook({ wireframe: this.f<HTMLInputElement>("wire").checked, textured: this.f<HTMLInputElement>("textured").checked, doubleSided: this.f<HTMLInputElement>("double").checked });
      if (this.clipName) await this.chooseClip(this.clipName);
      else this.describe();
      this.remember();
    } catch (e) {
      const info = this.el?.querySelector<HTMLElement>("[data-info]");
      if (info) info.textContent = e instanceof Error ? e.message : String(e);
    }
  }

  private say(text: string): void {
    const info = this.el?.querySelector<HTMLElement>("[data-info]");
    if (info) info.textContent = text;
  }

  /** The person on screen as a character look (what the character code holds). */
  private currentLook(): CharacterLook {
    const head = this.f<HTMLSelectElement>("head").value, hair = this.f<HTMLSelectElement>("hair").value;
    return {
      cos: this.f<HTMLSelectElement>("cos").value, head: head.startsWith("(") ? "" : head, hair: hair.startsWith("(") ? "" : hair,
      ageYears: Number(this.f<HTMLInputElement>("age").value), weightKg: Number(this.f<HTMLInputElement>("weight").value),
      layers: this.look.layers ?? {}, accessories: this.look.accessories ?? {},
    };
  }

  /** What the loading-scene editor takes from the viewer: the person, their clip and the frame showing now; null before a person is built. */
  private sceneSource(): SceneSource | null {
    if (!this.model || !this.clip || !this.clipName) return null;
    return { look: this.currentLook(), clip: this.clipName, frame: Math.round(anmFramePosition(this.clip, this.timeMs)) };
  }

  private async copyTo(): Promise<void> {
    const text = encodeCharacter(this.currentLook());
    try { await navigator.clipboard.writeText(text); this.say("Character copied to the clipboard."); } catch { this.say("The browser did not allow writing to the clipboard."); }
  }

  private async copyFrom(): Promise<void> {
    let text = "";
    try { text = await navigator.clipboard.readText(); } catch { this.say("The browser did not allow reading the clipboard."); return; }
    const c = decodeCharacter(text);
    if (!c) { this.say("The clipboard does not hold a character."); return; }
    const set = (name: string, value: string) => { const sel = this.f<HTMLSelectElement>(name); if ([...sel.options].some((o) => o.value === value)) { sel.value = value; return true; } return false; };
    if (!set("cos", c.cos)) { this.say(`This game has no costume ${c.cos}.`); return; }
    set("head", c.head || "(default for the costume)");
    set("hair", c.hair || "(none)");
    this.f<HTMLInputElement>("age").value = String(Math.round(Math.min(80, Math.max(18, c.ageYears))));
    this.f<HTMLInputElement>("weight").value = String(Math.round(Math.min(120, Math.max(50, c.weightKg))));
    this.showNumbers();
    this.optionsFor = ""; // the costume's variable parts are rebuilt, then the pasted choices put back
    this.pending = { layers: c.layers, accessories: c.accessories };
    await this.rebuild();
  }

  /** A select per variable texture layer and per accessory of the costume; a change rebuilds the person. */
  private showCostumeOptions(): void {
    const box = this.el!.querySelector<HTMLElement>("[data-costume]")!;
    box.textContent = "";
    const add = (kind: "layers" | "accessories", o: CostumeOptions["layers"][number]) => {
      const label = document.createElement("div");
      label.innerHTML = pickHtml(o.slot ? o.slot.replace(/^cos_/, "") : o.file, "");
      const sel = label.querySelector("select")!;
      if (kind === "accessories") sel.add(new Option("(none)", ""));
      for (const v of o.variants) sel.add(new Option(`variant ${v}`, String(v)));
      const chosen = this.look[kind]?.[o.index];
      sel.value = chosen !== undefined && o.variants.includes(chosen) ? String(chosen) : kind === "accessories" ? "" : String(o.current);
      sel.addEventListener("change", () => {
        const group = (this.look[kind] ??= {});
        if (sel.value === "") delete group[o.index];
        else group[o.index] = Number(sel.value);
        void this.rebuild();
      });
      box.append(label);
    };
    if (this.options.layers.length) box.append(Object.assign(document.createElement("h4"), { textContent: "Costume layers" }));
    for (const o of this.options.layers) add("layers", o);
    if (this.options.accessories.length) box.append(Object.assign(document.createElement("h4"), { textContent: "Accessories" }));
    for (const o of this.options.accessories) add("accessories", o);
    this.showCounts();
  }

  private describe(): void {
    const info = this.el?.querySelector<HTMLElement>("[data-info]");
    if (!info || !this.model) return;
    const verts = this.model.parts.reduce((n, p) => n + p.positions.length / 3, 0);
    info.textContent = `${verts} vertices, ${this.model.parts.length} parts, ${this.model.skeleton.length} bones` + (this.clip ? `; ${this.clipName}: ${this.clip.nFrames} frames, ${(anmDurationMs(this.clip) / 1000).toFixed(2)} s` : "");
  }

  /** Per frame: advance the clip and re-skin. */
  private tick(dtMs: number): void {
    if (this.orbit && this.camera) this.camera.alpha += (dtMs / 1000) * ORBIT_SPEED;
    if (!this.model || !this.meshes || !this.clip) return;
    const dur = anmDurationMs(this.clip);
    if (this.playing) {
      this.timeMs = (this.timeMs + dtMs * this.speed) % dur;
      this.f<HTMLInputElement>("scrub").value = String(this.timeMs / dur);
    }
    const frame = this.el?.querySelector<HTMLElement>("[data-frame]");
    if (frame) frame.textContent = `Frame ${Math.floor(this.timeMs / FRAME_MS + 1e-6) % this.clip.nFrames} of ${this.clip.nFrames}`;
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

/** A list with < > buttons and its position ("12 / 400"); `attrs` go on the select. */
function pickHtml(label: string, attrs: string): string {
  return `<div class="pick"><div class="pick-head"><span>${label}</span><output></output></div>` +
    `<div class="stepper"><button type="button" tabindex="-1" data-step="-1" title="Previous (arrow key)">‹</button>` +
    `<select ${attrs} aria-label="${label}"></select>` +
    `<button type="button" tabindex="-1" data-step="1" title="Next (arrow key)">›</button></div></div>`;
}

/** Move a list's choice by `delta` (wrapping round) and tell its listeners. */
function stepSelect(sel: HTMLSelectElement, delta: number): void {
  const n = sel.options.length;
  if (!n) return;
  const i = sel.selectedIndex < 0 ? 0 : sel.selectedIndex;
  // a long jump (page keys) stops at the ends; a single step wraps
  setIndex(sel, Math.abs(delta) > 1 ? Math.min(n - 1, Math.max(0, i + delta)) : (i + delta + n) % n);
}

function setIndex(sel: HTMLSelectElement, i: number): void {
  if (i < 0 || i >= sel.options.length || i === sel.selectedIndex) return;
  sel.selectedIndex = i;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Random variants for each of a costume's layers, and about half its accessories. */
function randomLook(o: CostumeOptions): CostumeLook {
  const any = (xs: number[]) => xs[Math.floor(Math.random() * xs.length)];
  const look: CostumeLook = { layers: {}, accessories: {} };
  for (const l of o.layers) { const v = any(l.variants); if (v !== undefined) look.layers![l.index] = v; }
  for (const a of o.accessories) { const v = any(a.variants); if (v !== undefined && Math.random() < 0.5) look.accessories![a.index] = v; }
  return look;
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
