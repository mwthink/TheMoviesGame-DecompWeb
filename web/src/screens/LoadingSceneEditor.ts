import type { PakIndex } from "../assets/Pak.ts";
import type { CharacterLook } from "../sim/character/CharacterCode.ts";
import { DEFAULT_CHARACTER } from "./LoadingCharacterFraming.ts";
import { buildSceneLayers, type SceneLayers } from "./LoadingSceneLayers.ts";
import { sceneToCode } from "./loadingSceneCode.ts";
import { LOADING_SCENES, type BackdropSettings, type LoadingScene } from "./loadingScenes.ts";
import { DEFAULT_LOADING_LAYOUT, LoadingView } from "./LoadingView.ts";
import { centreView, extent, move, overview, turn, type Cam, type Vec3 } from "./loadingCameraMath.ts";
import { mountScreen, unmountScreen } from "./Screen.ts";
import { gameStrings } from "./frontEndArt.ts";
import { pickTip } from "./loadingTips.ts";

/** What the editor needs from the viewer: the person on screen and the pose they are in. */
export interface SceneSource {
  look: CharacterLook;
  clip: string;
  /** The frame the clip is showing now (a stored frame number). */
  frame: number;
}

const BACKDROP_DEFAULT: BackdropSettings = { mesh: "", eye: [0, 0, 1.8], look: [0, 10, 1.8], fovDeg: 70, blurPx: 14, brightness: 1 };

/** A number field: label, the data name, and its limits. */
const NUMBERS: [string, string, number, number, number][] = [
  ["Size", "size", 0.3, 1.2, 0.01], ["Nudge across", "nudgeX", -0.3, 0.3, 0.005], ["Nudge up", "nudgeY", -0.2, 0.3, 0.005], ["Turn", "turn", -180, 180, 1],
];
/** The fields that change the set's camera, blur or brightness: edits to these redraw the set at once instead of rebuilding the preview. */
const LIVE = new Set(["ex", "ey", "ez", "lx", "ly", "lz", "fov", "blur", "bright", "sharp"]);
/** What the preview's mouse and keys do, shown on it. */
const HINT = "Drag: look around · Right-drag or Shift-drag: move sideways and up · Wheel: forward / back · Ctrl + wheel: zoom (field of view) · W A S D: fly, Q E: down / up (Shift: faster)";
const POINTS: [string, string][] = [["Camera x", "ex"], ["y", "ey"], ["z", "ez"], ["Looks at x", "lx"], ["y", "ly"], ["z", "lz"]];

/**
 * The loading-scene editor of the character viewer (docs/LOADING_SCREENS.md, "The scene editor"): the person and pose on the viewer's screen become the scene's character, and this
 * panel sets where they stand, which film set is blurred behind them and from where, and the backdrop colour. **Preview** draws the real loading layers over the whole window with a
 * sample tip; **Copy scene as code** puts the TypeScript for `LOADING_SCENES` on the clipboard. Nothing is saved anywhere else: the code is pasted into the repository.
 */
export class LoadingSceneEditor {
  private root: HTMLElement | null = null;
  private preview: { screen: HTMLElement; view: LoadingView; layers: SceneLayers | null; stop: () => void; token: number } | null = null;
  /** The viewer's side panel, which stays up beside the preview and can be folded away. */
  private panel: HTMLElement | null = null;
  private refreshTimer = 0;
  private liveFrame = 0;
  private readonly onEdit = (e: Event) => {
    const key = (e.target as HTMLElement | null)?.dataset?.s;
    if (key && LIVE.has(key)) this.liveBackdrop();
    else this.scheduleRefresh();
  };
  private readonly onKey = (e: KeyboardEvent) => {
    if (!this.preview) return;
    if (e.key === "Escape") { e.stopPropagation(); void this.closePreview(); return; }
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    const k = e.key.toLowerCase();
    if (!"wasdqe".includes(k) || k.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    // the preview owns these letters while it is open (the viewer's own W, B, ... shortcuts would otherwise fire)
    e.preventDefault();
    e.stopPropagation();
    const step = this.step() * 3 * (e.shiftKey ? 4 : 1);
    this.flyBy(k === "w" ? step : k === "s" ? -step : 0, k === "d" ? step : k === "a" ? -step : 0, k === "e" ? step : k === "q" ? -step : 0);
  };

  constructor(
    private readonly container: HTMLElement,
    private readonly pak: () => PakIndex | null,
    private readonly source: () => SceneSource | null,
    private readonly say: (text: string) => void,
  ) {}

  /** The panel's markup, for the viewer to put in a `<details>`. */
  html(): string {
    const num = ([label, key, min, max, step]: (typeof NUMBERS)[number]) =>
      `<label>${label} <input type="range" data-s="${key}" min="${min}" max="${max}" step="${step}" value="${key === "size" ? 0.85 : 0}"><output data-so="${key}"></output></label>`;
    const point = ([label, key]: [string, string]) => `<label class="pt">${label} <input type="number" data-s="${key}" step="0.1"></label>`;
    return `
      <label>Name <input type="text" data-s="name" value="new scene" maxlength="40"></label>
      <label>Start from <select data-s="from"><option value="">(this person, defaults)</option>${LOADING_SCENES.map((s, i) => `<option value="${i}">${s.name}</option>`).join("")}</select></label>
      <label>Side <select data-s="side"><option value="left">left</option><option value="right">right</option></select></label>
      ${NUMBERS.map(num).join("")}
      <label class="check"><input type="checkbox" data-s="hold" checked> Hold the frame shown now <output data-so="frame"></output></label>
      <label>Backdrop colour <input type="color" data-s="bg" value="#1d2a44"></label>
      <label class="check"><input type="checkbox" data-s="useSet"> A film set behind</label>
      <div data-s-set hidden>
        <label>Set <select data-s="mesh"></select></label>
        <div class="points">${POINTS.map(point).join("")}</div>
        <label>Field of view <input type="range" data-s="fov" min="20" max="120" step="1" value="70"><output data-so="fov"></output></label>
        <label>Blur <input type="range" data-s="blur" min="0" max="40" step="1" value="14"><output data-so="blur"></output></label>
        <label class="check"><input type="checkbox" data-s="sharp" checked> Show it sharp in the preview (the blur above is what is exported)</label>
        <label>Brightness <input type="range" data-s="bright" min="0.2" max="2" step="0.05" value="1"><output data-so="bright"></output></label>
        <div class="actions"><button type="button" data-s-overview>Overview from above</button> <button type="button" data-s-centre>Stand in the middle</button></div>
        <p class="info" data-s-bounds>Open the preview, then drag in it to look and move (keys: W A S D Q E).</p>
      </div>
      <div class="actions"><button type="button" data-s-preview>Preview</button> <button type="button" data-s-copy>Copy scene as code</button></div>`;
  }

  /** Wire the panel once its markup is in the page. */
  wire(root: HTMLElement): void {
    this.root = root;
    const p = this.pak();
    const mesh = this.field<HTMLSelectElement>("mesh");
    for (const f of p?.list("data\\meshes\\") ?? []) if (/^set_.*\.msh$/i.test(f.entry.name)) mesh.add(new Option(f.entry.name, f.entry.name));
    this.setBackdrop(BACKDROP_DEFAULT);
    root.addEventListener("input", () => this.showNumbers());
    // any change in the viewer's panel (this section, or the person and pose above it) redraws an open preview
    this.panel = root.closest<HTMLElement>(".screen.viewer");
    this.panel?.addEventListener("input", this.onEdit);
    this.panel?.addEventListener("change", this.onEdit);
    this.field<HTMLInputElement>("useSet").addEventListener("change", () => this.showSet());
    this.field<HTMLSelectElement>("from").addEventListener("change", () => this.startFrom());
    root.querySelector("[data-s-preview]")!.addEventListener("click", () => void this.openPreview());
    root.querySelector("[data-s-copy]")!.addEventListener("click", () => void this.copy());
    root.querySelector("[data-s-overview]")!.addEventListener("click", () => this.jump("overview"));
    root.querySelector("[data-s-centre]")!.addEventListener("click", () => this.jump("centre"));
    window.addEventListener("keydown", this.onKey, true);
    this.showSet();
    this.showNumbers();
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKey, true);
    this.panel?.removeEventListener("input", this.onEdit);
    this.panel?.removeEventListener("change", this.onEdit);
    window.clearTimeout(this.refreshTimer);
    void this.closePreview();
    this.root = null;
  }

  private field<T extends HTMLElement>(name: string): T {
    return this.root!.querySelector<T>(`[data-s="${name}"]`)!;
  }

  private val(name: string): number {
    return Number(this.field<HTMLInputElement>(name).value);
  }

  private showSet(): void {
    this.root!.querySelector<HTMLElement>("[data-s-set]")!.hidden = !this.field<HTMLInputElement>("useSet").checked;
  }

  private showNumbers(): void {
    const out = (key: string, text: string) => { const o = this.root?.querySelector(`[data-so="${key}"]`); if (o) o.textContent = text; };
    for (const [, key] of NUMBERS) out(key, key === "turn" ? `${this.val(key)}°` : String(this.val(key)));
    out("fov", `${this.val("fov")}°`);
    out("blur", `${this.val("blur")} px`);
    out("bright", String(this.val("bright")));
    out("frame", this.source() ? `(frame ${this.source()!.frame})` : "");
  }

  private setBackdrop(b: BackdropSettings): void {
    const sel = this.field<HTMLSelectElement>("mesh");
    if ([...sel.options].some((o) => o.value === b.mesh)) sel.value = b.mesh;
    const set = (k: string, v: number) => { this.field<HTMLInputElement>(k).value = String(v); };
    ([["ex", b.eye[0]], ["ey", b.eye[1]], ["ez", b.eye[2]], ["lx", b.look[0]], ["ly", b.look[1]], ["lz", b.look[2]], ["fov", b.fovDeg], ["blur", b.blurPx], ["bright", b.brightness]] as [string, number][]).forEach(([k, v]) => set(k, v));
  }

  /** Fill the placement and backdrop fields from one of the scenes already in `LOADING_SCENES`. */
  private startFrom(): void {
    const i = this.field<HTMLSelectElement>("from").value;
    if (i === "") return;
    const s = LOADING_SCENES[Number(i)]!;
    const set = (k: string, v: string | number) => { this.field<HTMLInputElement>(k).value = String(v); };
    set("name", `${s.name} copy`);
    set("side", s.character.side);
    set("size", s.character.size); set("nudgeX", s.character.nudgeX); set("nudgeY", s.character.nudgeY); set("turn", s.character.turn);
    set("bg", s.background);
    this.field<HTMLInputElement>("useSet").checked = !!s.backdrop;
    if (s.backdrop) this.setBackdrop(s.backdrop);
    this.showSet();
    this.showNumbers();
  }

  /** The scene the panel describes, with the viewer's person and pose; null while there is no person yet. */
  scene(): LoadingScene | null {
    const src = this.source();
    if (!src) return null;
    const useSet = this.field<HTMLInputElement>("useSet").checked && this.field<HTMLSelectElement>("mesh").value !== "";
    const name = this.field<HTMLInputElement>("name").value.trim() || "scene";
    return {
      name,
      character: {
        ...DEFAULT_CHARACTER, enabled: true, side: this.field<HTMLSelectElement>("side").value === "right" ? "right" : "left",
        size: this.val("size"), nudgeX: this.val("nudgeX"), nudgeY: this.val("nudgeY"), turn: this.val("turn"),
        costume: src.look.cos, clip: src.clip, frame: this.field<HTMLInputElement>("hold").checked ? src.frame : undefined, look: src.look,
      },
      background: this.field<HTMLInputElement>("bg").value,
      backdrop: useSet ? {
        mesh: this.field<HTMLSelectElement>("mesh").value, eye: [this.val("ex"), this.val("ey"), this.val("ez")], look: [this.val("lx"), this.val("ly"), this.val("lz")],
        fovDeg: this.val("fov"), blurPx: this.val("blur"), brightness: this.val("bright"),
      } : undefined,
    };
  }

  private async copy(): Promise<void> {
    const s = this.scene();
    if (!s) { this.say("There is no person to make a scene from yet."); return; }
    try { await navigator.clipboard.writeText(`${sceneToCode(s)}\n`); this.say("Scene code copied. Paste it into LOADING_SCENES in loadingScenes.ts."); } catch { this.say("The browser did not allow writing to the clipboard."); }
  }

  /**
   * Show the scene as the loading screen would, in the window beside the editor panel (which stays up; the toggle on the preview folds it away to see the whole window), with a
   * sample tip and a moving bar. Changing anything in the panel redraws it. Escape or the button closes it.
   */
  private async openPreview(): Promise<void> {
    await this.closePreview();
    const pak = this.pak();
    if (!pak || !this.scene()) { this.say("There is no person to preview yet."); return; }
    const screen = mountScreen(this.container, "menu loading dressed preview");
    const view = new LoadingView();
    view.setLayout({ ...DEFAULT_LOADING_LAYOUT, background: "dark" });
    view.setBackdrop("transparent");
    view.setLegacyPanel(true);
    view.setTip({ heading: "Preview", body: "This is how the loading screen looks with this scene: the character and the set behind, and the box on top. Escape closes it." });
    screen.append(view.element);
    const button = (text: string, className: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = text; b.className = className;
      b.addEventListener("click", onClick);
      screen.append(b);
      return b;
    };
    this.addPad(screen);
    const hint = document.createElement("p");
    hint.className = "previewhint"; hint.textContent = HINT;
    screen.append(hint);
    button("Close preview", "previewclose", () => void this.closePreview());
    const toggle = button("Hide editor", "previewtoggle", () => {
      const hidden = !this.panel!.classList.contains("collapsed");
      this.panel!.classList.toggle("collapsed", hidden);
      screen.classList.toggle("full", hidden);
      toggle.textContent = hidden ? "Show editor" : "Hide editor";
    });
    let fraction = 0;
    const timer = window.setInterval(() => { fraction = (fraction + 0.02) % 1.02; view.setProgress(fraction, "Loading"); }, 100);
    this.preview = { screen, view, layers: null, stop: () => window.clearInterval(timer), token: 0 };
    const strings = await gameStrings();
    const tip = strings ? pickTip(strings) : null;
    if (tip) view.setTip(tip);
    await this.draw();
  }

  /** (Re)draw the preview's layers from the panel as it is now. */
  private async draw(): Promise<void> {
    const p = this.preview, pak = this.pak(), scene = this.previewScene();
    if (!p || !pak || !scene) return;
    const token = ++p.token;
    p.layers?.dispose();
    p.layers = null;
    const layers = await buildSceneLayers(pak, p.screen, p.view.element, scene);
    if (this.preview !== p || p.token !== token) { layers?.dispose(); return; } // closed, or a newer drawing took over
    if (!layers) { this.say("The scene could not be drawn (check the costume and animation exist)."); return; }
    p.layers = layers;
    this.showBounds();
  }

  /** The camera as the fields hold it. */
  private cam(): Cam {
    const v = (a: string, b: string, c: string): Vec3 => [this.val(a), this.val(b), this.val(c)];
    return { eye: v("ex", "ey", "ez"), look: v("lx", "ly", "lz") };
  }

  /** Write a camera (and optionally the field of view) into the fields and redraw the set. */
  private setCam(c: Cam, fovDeg?: number): void {
    const put = (k: string, n: number) => { this.field<HTMLInputElement>(k).value = String(Math.round(n * 100) / 100); };
    put("ex", c.eye[0]); put("ey", c.eye[1]); put("ez", c.eye[2]);
    put("lx", c.look[0]); put("ly", c.look[1]); put("lz", c.look[2]);
    if (fovDeg !== undefined) { this.field<HTMLInputElement>("fov").value = String(Math.round(fovDeg)); this.showNumbers(); }
    this.liveBackdrop();
  }

  /** Redraw the open preview's set from the fields, at most once a frame (a drag fires many events). */
  private liveBackdrop(): void {
    if (this.liveFrame || !this.preview?.layers) return;
    this.liveFrame = requestAnimationFrame(() => {
      this.liveFrame = 0;
      const s = this.previewScene();
      if (s?.backdrop) this.preview?.layers?.updateBackdrop(s.backdrop);
    });
  }

  /** The scene as the preview draws it: the same, except the set has no blur when "Show it sharp" is on (it is hard to find a place through the blur). */
  private previewScene(): LoadingScene | null {
    const s = this.scene();
    if (s?.backdrop && this.field<HTMLInputElement>("sharp").checked) return { ...s, backdrop: { ...s.backdrop, blurPx: 0 } };
    return s;
  }

  /** How far one step of the mouse or keys moves the camera: a fraction of the set's size (1 unit without a set). */
  private step(): number {
    const b = this.preview?.layers?.backdropBounds();
    return (b ? extent(b) : 10) / 600;
  }

  private flyBy(fwd: number, side: number, up: number): void {
    this.setCam(move(this.cam(), fwd, side, up));
  }

  /** Mouse, wheel and touch on the preview move the set's camera (see `HINT`). */
  private addPad(screen: HTMLElement): void {
    const pad = document.createElement("div");
    pad.className = "previewpad";
    screen.append(pad);
    let drag: { x: number; y: number; mode: "look" | "move" } | null = null;
    pad.addEventListener("contextmenu", (e) => e.preventDefault());
    pad.addEventListener("pointerdown", (e) => {
      if (!this.field<HTMLInputElement>("useSet").checked) return;
      drag = { x: e.clientX, y: e.clientY, mode: e.button === 2 || e.shiftKey ? "move" : "look" };
      pad.setPointerCapture(e.pointerId);
      pad.classList.add("dragging");
    });
    pad.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.mode === "look") this.setCam(turn(this.cam(), dx * 0.005, -dy * 0.005));
      else this.flyBy(0, -dx * this.step(), dy * this.step());
    });
    const end = () => { drag = null; pad.classList.remove("dragging"); };
    pad.addEventListener("pointerup", end);
    pad.addEventListener("pointercancel", end);
    pad.addEventListener("wheel", (e) => {
      if (!this.field<HTMLInputElement>("useSet").checked) return;
      e.preventDefault();
      if (e.ctrlKey || e.altKey || e.metaKey) {
        this.field<HTMLInputElement>("fov").value = String(Math.min(120, Math.max(20, this.val("fov") + e.deltaY * 0.05)));
        this.showNumbers();
        this.liveBackdrop();
      } else {
        this.flyBy(-e.deltaY * this.step() * 0.25 * (e.shiftKey ? 4 : 1), 0, 0);
      }
    }, { passive: false });
  }

  /** "Overview from above" and "Stand in the middle": a camera placed from the set's size, to start from. */
  private jump(kind: "overview" | "centre"): void {
    const b = this.preview?.layers?.backdropBounds();
    if (!b) { this.say("Open the preview with a film set first; the set's size is read when it is drawn."); return; }
    const v = kind === "overview" ? overview(b) : centreView(b);
    this.setCam(v, v.fovDeg);
  }

  private showBounds(): void {
    const b = this.preview?.layers?.backdropBounds();
    const o = this.root?.querySelector<HTMLElement>("[data-s-bounds]");
    if (!o || !b) return;
    const r = (a: number, c: number) => `${Math.round(a)} to ${Math.round(c)}`;
    o.textContent = `This set spans x ${r(b.min[0], b.max[0])}, y ${r(b.min[1], b.max[1])}, z ${r(b.min[2], b.max[2])}. Drag in the preview to look, right-drag to move, wheel to go forward.`;
  }

  /** An edit redraws the open preview shortly after the last one (a drag fires many). */
  private scheduleRefresh(): void {
    if (!this.preview) return;
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => void this.draw(), 700);
  }

  private async closePreview(): Promise<void> {
    const p = this.preview;
    if (!p) return;
    this.preview = null;
    window.clearTimeout(this.refreshTimer);
    this.panel?.classList.remove("collapsed"); // the editor comes back with the preview closed
    p.stop();
    p.layers?.dispose();
    await unmountScreen(p.screen);
  }
}
