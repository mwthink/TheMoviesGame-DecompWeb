import { frontEndLogo } from "./frontEndArt.ts";
import { mountScreen, unmountScreen, type Screen } from "./Screen.ts";

interface MenuItem {
  label: string;
  /** Only items with an action are enabled. */
  action?: () => void;
}

/** Main menu. Everything is listed, but only Load Game does anything yet. */
export class MainMenuScreen implements Screen {
  private el: HTMLElement | null = null;

  private readonly onLoadingScreens: (() => void) | undefined;

  constructor(private readonly container: HTMLElement, private readonly onLoadGame: () => void, onLoadingScreens?: () => void) {
    this.onLoadingScreens = onLoadingScreens;
  }

  enter(): void {
    const items: MenuItem[] = [
      { label: "Continue" },
      { label: "New Game" },
      { label: "Load Game", action: this.onLoadGame },
      { label: "Tutorial" },
      { label: "Sandbox" },
      { label: "Options" },
      { label: "Credits" },
      { label: "Quit" },
    ];
    // A dev tool, not a game feature: browse the original's loading pictures.
    if (import.meta.env.DEV && this.onLoadingScreens) items.push({ label: "Loading screens (dev)", action: this.onLoadingScreens });

    this.el = mountScreen(this.container, "menu");
    this.el.innerHTML = `<h2>Main Menu</h2><ul></ul><div class="footer">Open The Movies - early development</div>`;
    const list = this.el.querySelector("ul")!;
    for (const item of items) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      if (item.action) {
        button.addEventListener("click", item.action);
      } else {
        button.disabled = true;
        button.title = "Not implemented yet";
      }
      li.appendChild(button);
      list.appendChild(li);
    }
    this.el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const el = this.el;
    void frontEndLogo().then((logo) => {
      if (logo && el.isConnected) {
        el.querySelector("h2")!.replaceWith(logo);
      }
    });
  }

  exit(): void {
    if (this.el) { void unmountScreen(this.el); this.el = null; }
  }
}
