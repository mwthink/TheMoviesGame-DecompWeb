import { mountScreen, unmountScreen, type Screen } from "./Screen.ts";

const SPLASH_MS = 3000;

/** Title card. Moves on after a few seconds, or immediately on a click or key press. */
export class SplashScreen implements Screen {
  private el: HTMLElement | null = null;
  private timer = 0;
  private readonly skip = () => this.finish();

  constructor(private readonly container: HTMLElement, private readonly onDone: () => void) {}

  enter(): void {
    this.el = mountScreen(this.container, "splash");
    this.el.innerHTML = `
      <h1>Open The <span>Movies</span></h1>
      <p>A fan reimplementation</p>
      <p class="hint">Click or press any key</p>`;
    this.el.addEventListener("click", this.skip);
    window.addEventListener("keydown", this.skip);
    this.timer = window.setTimeout(this.skip, SPLASH_MS);
  }

  exit(): void {
    window.clearTimeout(this.timer);
    window.removeEventListener("keydown", this.skip);
    if (this.el) { void unmountScreen(this.el); this.el = null; }
  }

  private finish(): void {
    if (!this.el) return;
    this.onDone();
  }
}
