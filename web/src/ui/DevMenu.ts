/**
 * The developer menu: a panel fixed to the bottom-right of the game view for testing controls and read-only state. It is plain DOM, outside the
 * engine. Rows are added once and their text is refreshed a few times a second.
 */
import { DEBUG_MODES } from "../world/SunLight.ts";
import { DEFAULT_SHADOWS, DEFAULT_SUN, normalizeShadows, normalizeSun, type ShadowSettings, type SunSettings } from "../world/Sun.ts";

/** Callbacks for the dev tools section: time scale and single steps, debug views, the sky variant, the shadow viewers and the hover highlight. */
export interface DevTools {
  onTimeScale?: (scale: number) => void;
  onStep?: () => void;
  onDebugMode?: (mode: number) => void;
  onSkyVariant?: (v: "auto" | 0 | 1 | 2) => void;
  onShadowFrustum?: (on: boolean) => void;
  onHighlight?: (on: boolean) => void;
  /** Movement: let loose people wander; the gait (0 stroll, 1 walk, 2 run) right-click orders use. */
  onWander?: (on: boolean) => void;
  /** Movement: let loose people act on their desires (walk to a toilet or a counter). */
  onDesires?: (on: boolean) => void;
  onGait?: (gait: 0 | 1 | 2) => void;
  /** The canvas the shadow map viewer draws into (the game view fills it). */
  shadowViewCanvas?: (canvas: HTMLCanvasElement | null) => void;
}

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

  constructor(private readonly onCamera: (mode: CameraMode) => void, gameCameraAvailable: boolean, onRevealAlways: (on: boolean) => void = () => {}, onSun: (s: SunSettings) => void = () => {}, onShadows: (s: ShadowSettings) => void = () => {}, tools: DevTools = {}) {
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

    // Debug views, the shadow map viewer and frustum (docs/DEV_TOOLS.md).
    const viewSec = document.createElement("section");
    viewSec.innerHTML = `<h4>Views</h4>`;
    const modeSel = document.createElement("select");
    DEBUG_MODES.forEach((name, i) => modeSel.append(new Option(name, String(i))));
    modeSel.addEventListener("change", () => tools.onDebugMode?.(Number(modeSel.value)));
    const modeLabel = document.createElement("label");
    modeLabel.append("World shading ", modeSel);
    viewSec.append(modeLabel);
    const frustumBox = document.createElement("input");
    frustumBox.type = "checkbox";
    frustumBox.addEventListener("change", () => tools.onShadowFrustum?.(frustumBox.checked));
    const frustumLabel = document.createElement("label");
    frustumLabel.append(frustumBox, " Show the shadow frustum");
    viewSec.append(frustumLabel);
    const mapBox = document.createElement("input");
    mapBox.type = "checkbox";
    const mapCanvas = document.createElement("canvas");
    mapCanvas.width = 192;
    mapCanvas.height = 192;
    mapCanvas.className = "shadowview";
    mapCanvas.hidden = true;
    mapBox.addEventListener("change", () => { mapCanvas.hidden = !mapBox.checked; tools.shadowViewCanvas?.(mapBox.checked ? mapCanvas : null); });
    const mapLabel = document.createElement("label");
    mapLabel.append(mapBox, " Shadow map viewer (needs shadows on)");
    viewSec.append(mapLabel, mapCanvas);
    const hlBox = document.createElement("input");
    hlBox.type = "checkbox";
    hlBox.checked = true;
    hlBox.addEventListener("change", () => tools.onHighlight?.(hlBox.checked));
    const hlLabel = document.createElement("label");
    hlLabel.append(hlBox, " Outline what the pointer is over");
    viewSec.append(hlLabel);
    this.body.append(viewSec);

    // The sky's variant: the game picks it from the game year (before 1955, 1955 to 1994, 1995 on), so the default follows the clock (docs/SKY.md).
    const skySec = document.createElement("section");
    skySec.innerHTML = `<h4>Sky</h4>`;
    const skySel = document.createElement("select");
    [["auto", "From the game's year (as the game)"], ["0", "Era 1: before 1955"], ["1", "Era 2: 1955 to 1994"], ["2", "Era 3: 1995 on"]].forEach(([v, name]) => skySel.append(new Option(name, v)));
    skySel.addEventListener("change", () => tools.onSkyVariant?.(skySel.value === "auto" ? "auto" : (Number(skySel.value) as 0 | 1 | 2)));
    const skyLabel = document.createElement("label");
    skyLabel.append("Variant ", skySel);
    skySec.append(skyLabel);
    this.body.append(skySec);

    // Movement (docs/MOVEMENT.md): right-click the ground to send the person last clicked there.
    const moveSec = document.createElement("section");
    moveSec.innerHTML = `<h4>Movement</h4>`;
    const wanderBox = document.createElement("input");
    wanderBox.type = "checkbox";
    wanderBox.checked = true; // the scene starts with wandering on
    wanderBox.addEventListener("change", () => tools.onWander?.(wanderBox.checked));
    const wanderLabel = document.createElement("label");
    wanderLabel.append(wanderBox, " Loose people wander about");
    const desireBox = document.createElement("input");
    desireBox.type = "checkbox";
    desireBox.checked = true; // and with desires on
    desireBox.addEventListener("change", () => tools.onDesires?.(desireBox.checked));
    const desireLabel = document.createElement("label");
    desireLabel.append(desireBox, " Loose people act on desires (toilet, food, benches; docs/DESIRES.md)");
    const gaitSel = document.createElement("select");
    [["0", "Stroll"], ["1", "Walk"], ["2", "Run"]].forEach(([v, name]) => gaitSel.append(new Option(name, v)));
    gaitSel.value = "1";
    gaitSel.addEventListener("change", () => tools.onGait?.(Number(gaitSel.value) as 0 | 1 | 2));
    const gaitLabel = document.createElement("label");
    gaitLabel.append("Right-click gait ", gaitSel);
    const hint = document.createElement("p");
    hint.textContent = "Click a person, then right-click the ground.";
    moveSec.append(wanderLabel, desireLabel, gaitLabel, hint);
    this.body.append(moveSec);

    // Time: a scale on the game speed and single steps (for watching motion).
    const timeSec = document.createElement("section");
    timeSec.innerHTML = `<h4>Time control</h4>`;
    const scaleLabel = document.createElement("label");
    scaleLabel.className = "slider";
    const scaleOut = document.createElement("output");
    const scale = document.createElement("input");
    scale.type = "range";
    scale.min = "-1"; scale.max = "1"; scale.step = "0.05"; scale.value = "0"; // a log scale: 10^-1 .. 10^1
    const showScale = () => { scaleOut.textContent = `${(10 ** Number(scale.value)).toFixed(2)}x`; };
    showScale();
    scale.addEventListener("input", () => { showScale(); tools.onTimeScale?.(10 ** Number(scale.value)); });
    scaleLabel.append("Time scale ", scaleOut, scale);
    timeSec.append(scaleLabel);
    const stepBtn = document.createElement("button");
    stepBtn.type = "button";
    stepBtn.textContent = "Step one tick (0.1 s)";
    stepBtn.addEventListener("click", () => tools.onStep?.());
    timeSec.append(stepBtn);
    this.body.append(timeSec);
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
