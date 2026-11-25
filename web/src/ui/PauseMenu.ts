/**
 * The pause menu: Esc during play (or the menu bar's Pause button) opens it over the game. The original has one too (`pause.mfl`, the in-game menu that calls `ExternResume`,
 * `ExternSave` and `ExternQuitGame`, docs/FRONTEND.md); this has Resume, Options and Main menu. Saving is not in the app yet, so there is no Save button.
 * While it is open the game clock is paused by the game view; this class only draws the menu and reports the choices.
 */
export class PauseMenu {
  readonly element: HTMLElement;
  private readonly firstButton: HTMLButtonElement;

  constructor(handlers: { onResume: () => void; onOptions: () => void; onMainMenu: () => void }) {
    const el = document.createElement("div");
    el.className = "pausemenu";
    el.hidden = true;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Paused");
    el.innerHTML = `
      <div class="box">
        <h2>Paused</h2>
        <button type="button" data-act="resume">Resume</button>
        <button type="button" data-act="options">Options</button>
        <button type="button" data-act="menu">Main menu</button>
        <p class="hint">Main menu leaves the game; there is no saving yet.</p>
      </div>`;
    this.element = el;
    this.firstButton = el.querySelector<HTMLButtonElement>('[data-act="resume"]')!;
    el.querySelector('[data-act="resume"]')!.addEventListener("click", handlers.onResume);
    el.querySelector('[data-act="options"]')!.addEventListener("click", handlers.onOptions);
    el.querySelector('[data-act="menu"]')!.addEventListener("click", handlers.onMainMenu);
    // a click on the dimmed backdrop outside the box resumes
    el.addEventListener("click", (e) => { if (e.target === el) handlers.onResume(); });
  }

  get isOpen(): boolean { return !this.element.hidden; }

  open(): void {
    this.element.hidden = false;
    this.firstButton.focus();
  }

  close(): void { this.element.hidden = true; }

  mount(parent: HTMLElement): void { parent.append(this.element); }
  dispose(): void { this.element.remove(); }
}
