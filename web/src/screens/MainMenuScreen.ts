import { frontEndLogo } from "./frontEndArt.ts";
import { currentInstall, newestSave, onLinkChange, pendingLinks, regrantLinks, type SaveEntry } from "./gameLink.ts";
import { describeEntry } from "./LoadGameScreen.ts";
import { mountScreen, unmountScreen, type Screen } from "./Screen.ts";

interface MenuItem {
  label: string;
  /** Only items with an action are enabled. */
  action?: () => void;
  /** A second line under the label (Continue's save). */
  detail?: string;
}

/** Where the menu's entries lead. `needsGame` entries go through the Find your game screen first when the install is not linked. */
export interface MainMenuActions {
  continueGame(save: SaveEntry): void;
  newGame(): void;
  loadGame(): void;
  options(): void;
  viewer(): void;
  /** Open Find your game, then go on to `then` (or back to the menu). */
  linkGame(then?: () => void): void;
  /** Dev builds only. */
  loadingScreens?(): void;
}

/**
 * Main menu. Continue loads the newest save of the linked saved games folder; New Game, Load Game and the Character Viewer need the game folder, and lead to
 * Find your game first when it is not linked. The footer says which game folder is in use, or offers to link or re-allow it.
 */
export class MainMenuScreen implements Screen {
  private el: HTMLElement | null = null;
  private off: (() => void) | null = null;
  private newest: SaveEntry | null = null;
  private token = 0;

  constructor(private readonly container: HTMLElement, private readonly actions: MainMenuActions) {}

  enter(): void {
    this.el = mountScreen(this.container, "menu");
    this.el.innerHTML = `<h2>Main Menu</h2><ul></ul><div class="footer"><span class="link" data-id="link"></span><span>Open The Movies - early development</span></div>`;
    this.off = onLinkChange(() => { this.renderItems(); void this.findNewest(); });
    this.renderItems();
    void this.findNewest();
    this.el.querySelector<HTMLButtonElement>("ul button:not(:disabled)")?.focus();
    const el = this.el;
    void frontEndLogo().then((logo) => {
      if (logo && el.isConnected) el.querySelector("h2")?.replaceWith(logo);
    });
  }

  exit(): void {
    this.off?.();
    this.token++;
    if (this.el) { void unmountScreen(this.el); this.el = null; }
  }

  private async findNewest(): Promise<void> {
    const token = ++this.token;
    const save = await newestSave();
    if (token !== this.token) return;
    this.newest = save;
    this.renderItems();
  }

  private renderItems(): void {
    const el = this.el;
    if (!el) return;
    const a = this.actions;
    const linked = currentInstall() !== null;
    const needsGame = (go: () => void) => () => (currentInstall() ? go() : a.linkGame(go));
    const newest = this.newest;
    const items: MenuItem[] = [
      newest && linked ? { label: "Continue", action: () => a.continueGame(newest), detail: describeEntry(newest) } : { label: "Continue" },
      { label: "New Game", action: needsGame(a.newGame) },
      { label: "Load Game", action: needsGame(a.loadGame) },
      { label: "Tutorial" },
      { label: "Sandbox" },
      { label: "Options", action: a.options },
      { label: "Character Viewer", action: needsGame(a.viewer) },
      { label: "Credits" },
      { label: "Quit" },
    ];
    // A dev tool, not a game feature: browse the original's loading pictures.
    if (import.meta.env.DEV && a.loadingScreens) items.push({ label: "Loading screens (dev)", action: a.loadingScreens });

    const list = el.querySelector("ul")!;
    const hadFocus = list.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.label : undefined;
    list.replaceChildren();
    for (const item of items) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.label = item.label;
      button.textContent = item.label;
      if (item.detail) {
        const small = document.createElement("small");
        small.textContent = item.detail;
        button.append(small);
      }
      if (item.action) button.addEventListener("click", item.action);
      else {
        button.disabled = true;
        button.title = item.label !== "Continue" ? "Not implemented yet"
          : !linked ? "Link the game folder first (Find your game)" : "No saved game found yet (choose the saved games folder under Load Game)";
      }
      li.appendChild(button);
      list.appendChild(li);
    }
    if (hadFocus) list.querySelector<HTMLButtonElement>(`button[data-label="${hadFocus}"]`)?.focus();
    this.renderFooter();
  }

  private renderFooter(): void {
    const slot = this.el?.querySelector<HTMLElement>('[data-id="link"]');
    if (!slot) return;
    const install = currentInstall();
    const pend = pendingLinks();
    slot.replaceChildren();
    const button = (text: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "linkbutton";
      b.textContent = text;
      b.addEventListener("click", onClick);
      return b;
    };
    if (install) {
      slot.append(`Game: ${install.label} · `, button("Change", () => this.actions.linkGame()));
    } else if (pend.install) {
      slot.append(button(`Allow access to ${pend.install}`, () => void regrantLinks()), " · ", button("Choose another", () => this.actions.linkGame()));
    } else {
      slot.append("Game files not linked · ", button("Find your game", () => this.actions.linkGame()));
    }
  }
}
