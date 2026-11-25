/**
 * The developer menu: a panel fixed to the bottom-right of the game view for testing controls and read-only state. It is plain DOM, outside the
 * engine. Rows are added once and their text is refreshed a few times a second.
 */
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

  constructor(private readonly onCamera: (mode: CameraMode) => void, gameCameraAvailable: boolean, onRevealAlways: (on: boolean) => void = () => {}) {
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
