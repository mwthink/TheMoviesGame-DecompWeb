import { frontEndLogo } from "./frontEndArt.ts";
import { pendingLinks, regrantLinks, restoreLinks } from "./gameLink.ts";
import { mountScreen, unmountScreen, type Screen } from "./Screen.ts";

const SPLASH_MS = 3000;

/**
 * Title card. Moves on after a few seconds, or immediately on a click or key press.
 *
 * The click doubles as the permission click for remembered folders (`gameLink.ts`): a browser asks for read access again only from a user gesture, so when a
 * remembered game folder is waiting, the splash says so, does not time out, and its click asks for access before going on. A returning player gets the menu
 * fully dressed (logo, Continue) for that one click.
 */
export class SplashScreen implements Screen {
  private el: HTMLElement | null = null;
  private timer = 0;
  private waiting = false;
  private readonly skip = (e?: Event) => {
    if (e instanceof KeyboardEvent && (e.repeat || ["Shift", "Control", "Alt", "Meta"].includes(e.key))) return;
    void this.finish();
  };

  constructor(private readonly container: HTMLElement, private readonly onDone: () => void) {}

  enter(): void {
    this.el = mountScreen(this.container, "splash");
    this.el.innerHTML = `
      <h1>Open The <span>Movies</span></h1>
      <p>A fan reimplementation</p>
      <p class="hint">Click or press any key</p>`;
    this.el.addEventListener("click", this.skip);
    window.addEventListener("keydown", this.skip);
    this.timer = window.setTimeout(() => { if (!this.waiting) this.skip(); }, SPLASH_MS);
    const el = this.el;
    void restoreLinks().then(() => {
      const pend = pendingLinks();
      if (!el.isConnected || !(pend.install || pend.saves)) return;
      this.waiting = true;
      el.querySelector(".hint")!.textContent = `Click or press any key to open ${pend.install ?? pend.saves}`;
    });
    void frontEndLogo().then((logo) => {
      if (logo && el.isConnected) {
        el.querySelector("h1")!.before(logo);
        el.querySelector("h1")!.classList.add("visually-hidden");
      }
    });
  }

  exit(): void {
    window.clearTimeout(this.timer);
    window.removeEventListener("keydown", this.skip);
    if (this.el) { void unmountScreen(this.el); this.el = null; }
  }

  private async finish(): Promise<void> {
    if (!this.el) return;
    window.removeEventListener("keydown", this.skip);
    this.el.removeEventListener("click", this.skip);
    // Called synchronously inside the gesture; the browser's prompt (if any) appears now.
    if (this.waiting) await regrantLinks();
    if (this.el) this.onDone();
  }
}
