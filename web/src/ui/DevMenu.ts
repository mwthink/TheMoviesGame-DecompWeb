/**
 * The developer menu: a panel fixed to the bottom-right of the game view for testing controls and read-only state. It is plain DOM, outside the
 * engine. Rows are added once and their text is refreshed a few times a second.
 */
import { DEFAULT_SHADOWS, DEFAULT_SUN, normalizeShadows, normalizeSun, type ShadowSettings, type SunSettings } from "../world/Sun.ts";

export type CameraMode = "default" | "game";

export interface DevMenuState {
  [section: string]: Record<string, string>;
}

export class DevMenu {
  readonly element: HTMLElement;
  private readonly rows = new Map<string, HTMLElement>();
  private readonly body: HTMLElement;
  private readonly radios = new Map<CameraMode, HTMLInputElement>();
  private collapsed = false;

  constructor(private readonly onCamera: (mode: CameraMode) => void, gameCameraAvailable: boolean, onRevealAlways: (on: boolean) => void = () => {}, onSun: (s: SunSettings) => void = () => {}, onShadows: (s: ShadowSettings) => void = () => {}) {
    const el = document.createElement("aside");
    el.className = "devmenu";
    el.innerHTML = `<header><span>Dev menu</span><button type="button" title="Collapse">–</button></header><div class="body"></div>`;
    this.element = el;
    this.body = el.querySelector(".body")!;
    const toggle = el.querySelector("button")!;
    toggle.addEventListener("click", () => {
      this.collapsed = !this.collapsed;
      el.classList.toggle("collapsed", this.collapsed);
      toggle.textContent = this.collapsed ? "+" : "–";
    });

    // Camera selection (a control, the only one so far)
    const sec = document.createElement("section");
    sec.innerHTML = `<h4>Camera</h4>`;
    const choices: [CameraMode, string, boolean][] = [
      ["default", "Default (orbit)", true],
      ["game", "Game camera", gameCameraAvailable],
    ];
    for (const [mode, label, enabled] of choices) {
      const l = document.createElement("label");
      const r = document.createElement("input");
      r.type = "radio";
      r.name = "devmenu-camera";
      r.disabled = !enabled;
      r.checked = mode === "default";
      r.addEventListener("change", () => { if (r.checked) this.onCamera(mode); });
      l.append(r, ` ${label}${enabled ? "" : " (no camera.ini or lot)"}`);
      sec.append(l);
      this.radios.set(mode, r);
    }
    this.body.append(sec);

    // Floor plans: the game reveals a building's rooms by its own rules (docs/ROOM_DISPLAY.md); this shows them as soon as the pointer is over the building.
    const rooms = document.createElement("section");
    rooms.innerHTML = `<h4>Rooms</h4>`;
    const l = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.addEventListener("change", () => onRevealAlways(box.checked));
    l.append(box, " Show rooms on hover at once (ignore the reveal rules)");
    rooms.append(l);
    this.body.append(rooms);

    // The sun: a first experiment with dynamic light on the baked world (docs/LIGHTING.md). Off = the game's own look.
    const sunSec = document.createElement("section");
    sunSec.innerHTML = `<h4>Sun</h4>`;
    let sun: SunSettings = { ...DEFAULT_SUN };
    const emit = () => { sun = normalizeSun(sun); onSun(sun); };
    const onBox = document.createElement("input");
    onBox.type = "checkbox";
    onBox.addEventListener("change", () => { sun.enabled = onBox.checked; emit(); });
    const onLabel = document.createElement("label");
    onLabel.append(onBox, " Sun lighting");
    sunSec.append(onLabel);
    const slider = (label: string, key: "azimuth" | "elevation" | "intensity" | "ambient" | "baked", min: number, max: number, step: number, unit = "") => {
      const l = document.createElement("label");
      l.className = "slider";
      const out = document.createElement("output");
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(min); input.max = String(max); input.step = String(step);
      input.value = String(sun[key]);
      const show = () => { out.textContent = `${Number(input.value).toFixed(step < 1 ? 2 : 0)}${unit}`; };
      show();
      input.addEventListener("input", () => { sun[key] = Number(input.value); show(); emit(); });
      l.append(`${label} `, out, input);
      sunSec.append(l);
    };
    slider("Direction", "azimuth", 0, 360, 1, "°");
    slider("Height", "elevation", 2, 90, 1, "°");
    slider("Sun strength", "intensity", 0, 3, 0.05);
    slider("Ambient", "ambient", 0, 1.5, 0.05);
    slider("Baked light", "baked", 0, 2, 0.05);
    this.body.append(sunSec);

    // Shadows from the sun (docs/LIGHTING.md): they show only while Sun lighting is on.
    const shSec = document.createElement("section");
    shSec.innerHTML = `<h4>Shadows</h4>`;
    let shadows: ShadowSettings = { ...DEFAULT_SHADOWS };
    const emitShadows = () => { shadows = normalizeShadows(shadows); onShadows(shadows); };
    const shBox = document.createElement("input");
    shBox.type = "checkbox";
    shBox.addEventListener("change", () => { shadows.enabled = shBox.checked; emitShadows(); });
    const shLabel = document.createElement("label");
    shLabel.append(shBox, " Sun shadows (needs Sun lighting)");
    shSec.append(shLabel);
    const lowBox = document.createElement("input");
    lowBox.type = "checkbox";
    lowBox.addEventListener("change", () => { shadows.size = lowBox.checked ? 2048 : 4096; emitShadows(); });
    const lowLabel = document.createElement("label");
    lowLabel.append(lowBox, " Smaller map (2048, faster, blurrier)");
    shSec.append(lowLabel);
    const shSlider = (label: string, key: "darkness" | "bias", min: number, max: number, step: number) => {
      const l = document.createElement("label");
      l.className = "slider";
      const out = document.createElement("output");
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(min); input.max = String(max); input.step = String(step);
      input.value = String(shadows[key]);
      const show = () => { out.textContent = Number(input.value).toFixed(2); };
      show();
      input.addEventListener("input", () => { shadows[key] = Number(input.value); show(); emitShadows(); });
      l.append(`${label} `, out, input);
      shSec.append(l);
    };
    shSlider("Darkness", "darkness", 0, 1, 0.05);
    shSlider("Bias (units)", "bias", 0, 3, 0.05);
    this.body.append(shSec);
    for (const sec of this.body.querySelectorAll<HTMLElement>("section")) this.makeCollapsible(sec);
  }

  /** Click a section's heading to fold it away (the heading stays). */
  private makeCollapsible(sec: HTMLElement): void {
    const h = sec.querySelector("h4");
    if (!h || h.dataset.collapsible) return;
    h.dataset.collapsible = "1";
    h.tabIndex = 0;
    h.setAttribute("role", "button");
    const toggle = () => { const closed = sec.classList.toggle("closed"); h.setAttribute("aria-expanded", String(!closed)); };
    h.setAttribute("aria-expanded", "true");
    h.addEventListener("click", toggle);
    h.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  }

  /** Reflect a camera switch made elsewhere. */
  setCameraMode(mode: CameraMode): void {
    this.radios.get(mode)!.checked = true;
  }

  /** Update the read-only rows; creates sections and rows on first sight. */
  show(state: DevMenuState): void {
    for (const [section, values] of Object.entries(state)) {
      for (const [name, value] of Object.entries(values)) {
        const key = `${section}/${name}`;
        let row = this.rows.get(key);
        if (!row) {
          let sec = this.body.querySelector<HTMLElement>(`section[data-s="${CSS.escape(section)}"]`);
          if (!sec) {
            sec = document.createElement("section");
            sec.dataset.s = section;
            sec.innerHTML = `<h4>${section}</h4>`;
            this.body.append(sec);
            this.makeCollapsible(sec);
          }
          row = document.createElement("div");
          row.className = "row";
          row.innerHTML = `<span class="k"></span><span class="v"></span>`;
          row.querySelector(".k")!.textContent = name;
          sec.append(row);
          this.rows.set(key, row);
        }
        const v = row.querySelector(".v")!;
        if (v.textContent !== value) v.textContent = value;
      }
    }
    // Rows that this state no longer has (a section whose fields changed) are hidden too.
    for (const [key, row] of this.rows) {
      const [section, name] = [key.slice(0, key.indexOf("/")), key.slice(key.indexOf("/") + 1)];
      row.hidden = !(state[section] && name in state[section]!);
    }
    // Sections that are not part of this state (the other camera's) are hidden rather than left showing old values.
    for (const sec of this.body.querySelectorAll<HTMLElement>("section[data-s]")) sec.hidden = !(sec.dataset.s! in state);
  }

  mount(parent: HTMLElement): void { parent.append(this.element); }
  dispose(): void { this.element.remove(); }
}
