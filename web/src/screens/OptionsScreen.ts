import { ANISOTROPY_CHOICES, DEFAULT_SETTINGS, HELP_LEVELS, RENDER_SCALE_RANGE, type HelpLevel, type Settings, type SettingsStore } from "../settings/Settings.ts";
import { mountScreen, unmountScreen, type Screen } from "./Screen.ts";

/** Names of the help levels, the original's `GAMEPLAYOPTIONS_*HELP` strings. */
const HELP_LABELS: Record<HelpLevel, string> = { none: "No Extra Assistance", low: "Minimal Assistance", medium: "Moderate Assistance", max: "Maximum Assistance" };

/**
 * Options: the settings the web app has (`Settings.ts`, docs/OPTIONS.md), in two groups like the original's Video and Game option screens.
 * Every change is applied and stored at once; Escape or Back returns to the main menu.
 */
export class OptionsScreen implements Screen {
  private el: HTMLElement | null = null;
  private readonly onKey = (e: KeyboardEvent) => { if (e.key === "Escape") this.onBack(); };

  constructor(private readonly container: HTMLElement, private readonly store: SettingsStore, private readonly onBack: () => void) {}

  enter(): void {
    this.el = mountScreen(this.container, "menu options");
    this.render();
    window.addEventListener("keydown", this.onKey);
  }

  exit(): void {
    window.removeEventListener("keydown", this.onKey);
    if (this.el) { void unmountScreen(this.el); this.el = null; }
  }

  private render(): void {
    const el = this.el!;
    const s = this.store.get();
    const scaleSteps: number[] = [];
    for (let v = RENDER_SCALE_RANGE.min; v <= RENDER_SCALE_RANGE.max + 1e-9; v += RENDER_SCALE_RANGE.step) scaleSteps.push(v);
    const option = (value: string | number, label: string, selected: boolean) => `<option value="${value}"${selected ? " selected" : ""}>${label}</option>`;
    el.innerHTML = `
      <h2>Options</h2>
      <div class="optionsbox">
        <fieldset>
          <legend>Graphics</legend>
          <label>Render size <select data-key="renderScale">${scaleSteps.map((v) => option(v, `${Math.round(v * 100)} %`, v === s.renderScale)).join("")}</select></label>
          <label>Texture sharpness <select data-key="anisotropy">${ANISOTROPY_CHOICES.map((v) => option(v, `${v}x`, v === s.anisotropy)).join("")}</select></label>
          <label class="check"><input type="checkbox" data-key="smoothEdges"${s.smoothEdges ? " checked" : ""}> Smooth jagged edges (FXAA)</label>
          <label class="check"><input type="checkbox" data-key="showFps"${s.showFps ? " checked" : ""}> Show frames per second</label>
          <label class="check"><input type="checkbox" data-fullscreen${document.fullscreenElement ? " checked" : ""}> Full screen</label>
          <p class="hint">Render size below 100 % draws fewer pixels and is faster; above 100 % is sharper. Texture sharpness applies the next time a game loads.</p>
        </fieldset>
        <fieldset>
          <legend>Game</legend>
          <label>Level of help <select data-key="helpLevel">${HELP_LEVELS.map((v) => option(v, HELP_LABELS[v], v === s.helpLevel)).join("")}</select></label>
          <p class="hint">With no extra assistance the tooltips are turned off.</p>
        </fieldset>
      </div>
      <div class="actions"><button type="button" data-reset>Defaults</button><button type="button" data-back>Back</button></div>`;
    el.querySelectorAll<HTMLSelectElement>("select[data-key]").forEach((sel) => sel.addEventListener("change", () => this.change(sel.dataset.key as keyof Settings, sel.value)));
    el.querySelectorAll<HTMLInputElement>("input[data-key]").forEach((box) => box.addEventListener("change", () => this.change(box.dataset.key as keyof Settings, box.checked)));
    el.querySelector<HTMLInputElement>("input[data-fullscreen]")!.addEventListener("change", (e) => {
      const on = (e.target as HTMLInputElement).checked;
      void (on ? document.documentElement.requestFullscreen() : document.fullscreenElement ? document.exitFullscreen() : Promise.resolve()).catch(() => this.render());
    });
    el.querySelector("[data-back]")!.addEventListener("click", () => this.onBack());
    el.querySelector("[data-reset]")!.addEventListener("click", () => { this.store.reset(); this.render(); });
    el.querySelector<HTMLButtonElement>("[data-back]")!.focus();
  }

  /** One control changed: numbers come from selects as text. */
  private change(key: keyof Settings, value: string | boolean): void {
    const numeric = typeof DEFAULT_SETTINGS[key] === "number";
    this.store.set({ [key]: numeric ? Number(value) : value } as Partial<Settings>);
  }
}
