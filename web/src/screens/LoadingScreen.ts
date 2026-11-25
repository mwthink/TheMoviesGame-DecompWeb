import { gameStrings, randomLoadingPicture } from "./frontEndArt.ts";
import { LOADING_BOX, pickTip } from "./loadingTips.ts";
import { mountScreen, unmountScreen, type Screen } from "./Screen.ts";

/** How a load task reports progress: a fraction 0..1 when known, null for an indeterminate bar, and a line of text. */
export interface Progress {
  report(fraction: number | null, label: string): void;
}

/** A piece of work that yields the finished result, reporting as it goes. */
export type LoadTask<T> = (progress: Progress) => Promise<T>;

/**
 * Loading screen: runs a task and shows its progress until it finishes, then hands over the result (or the error).
 *
 * It is laid out like the original's (docs/LOADING_SCREENS.md): one of the game's loading pictures, chosen at random, as the background (a character, the logo and an
 * empty speech-bubble box, all in the picture), a tip from the game's string database written into that box (a heading and a paragraph, `loadingTips.ts`), and under the
 * tip, still inside the box, our own progress bar and current-step line. Without the game files (or while they are still being read) it falls back to the plain heading and bar.
 */
export class LoadingScreen<T> implements Screen {
  private el: HTMLElement | null = null;
  private cancelled = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly task: LoadTask<T>,
    private readonly onDone: (result: T) => void,
    private readonly onError: (message: string) => void,
  ) {}

  enter(): void {
    this.el = mountScreen(this.container, "menu loading");
    this.el.innerHTML = `
      <div class="loadpic" hidden><div class="loadbox">
        <div class="tip"><h3></h3><p></p></div>
        <div class="loadprogress"></div>
      </div></div>
      <h2 class="plainheading">Loading</h2>
      <div class="progress" role="progressbar" aria-label="Loading progress" aria-valuemin="0" aria-valuemax="100">
        <div class="fill"></div>
      </div>
      <p class="label">Starting</p>
      <p class="error" hidden></p>
      <div class="actions" hidden><button type="button">Back</button></div>`;
    this.el.querySelector<HTMLButtonElement>(".actions button")!.addEventListener("click", () => this.onError(""));
    void this.dress();
    void this.run();
  }

  exit(): void {
    this.cancelled = true;
    if (this.el) { void unmountScreen(this.el); this.el = null; }
  }

  /**
   * Put the picture and the tip in when they are ready: the picture becomes the background, the box rectangle (`LOADING_BOX`) is positioned over the picture's box, and the
   * progress bar and label move into it under the tip. Nothing changes if the game files are not there.
   */
  private async dress(): Promise<void> {
    const [picture, strings] = await Promise.all([randomLoadingPicture(), gameStrings()]);
    const el = this.el;
    if (!el || this.cancelled || !picture) return;
    const frame = el.querySelector<HTMLElement>(".loadpic")!;
    const box = el.querySelector<HTMLElement>(".loadbox")!;
    picture.canvas.className = "picture";
    picture.canvas.setAttribute("role", "img");
    picture.canvas.setAttribute("aria-label", "Loading screen picture");
    frame.prepend(picture.canvas);
    box.style.left = `${LOADING_BOX.x * 100}%`;
    box.style.top = `${LOADING_BOX.y * 100}%`;
    box.style.width = `${LOADING_BOX.width * 100}%`;
    box.style.height = `${LOADING_BOX.height * 100}%`;
    const tip = pickTip(strings);
    const tipEl = box.querySelector<HTMLElement>(".tip")!;
    if (tip) {
      tipEl.querySelector("h3")!.textContent = tip.heading;
      tipEl.querySelector("h3")!.hidden = !tip.heading;
      tipEl.querySelector("p")!.textContent = tip.body;
    } else tipEl.hidden = true;
    const holder = box.querySelector(".loadprogress")!;
    holder.append(el.querySelector(".progress")!, el.querySelector(".label")!);
    el.querySelector<HTMLElement>(".plainheading")!.hidden = true;
    frame.hidden = false;
    el.classList.add("dressed");
  }

  private async run(): Promise<void> {
    const progress: Progress = {
      report: (fraction, label) => this.show(fraction, label),
    };
    try {
      const result = await this.task(progress);
      if (!this.cancelled) this.onDone(result);
    } catch (e) {
      console.error(e);
      if (this.cancelled || !this.el) return;
      this.fail(e instanceof Error ? e.message : String(e));
    }
  }

  private show(fraction: number | null, label: string): void {
    const el = this.el;
    if (!el || this.cancelled) return;
    const bar = el.querySelector<HTMLElement>(".progress")!;
    const fill = el.querySelector<HTMLElement>(".fill")!;
    bar.classList.toggle("indeterminate", fraction === null);
    bar.setAttribute("aria-valuenow", fraction === null ? "" : String(Math.round(fraction * 100)));
    fill.style.width = fraction === null ? "" : `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    el.querySelector<HTMLElement>(".label")!.textContent = label;
  }

  private fail(message: string): void {
    const el = this.el!;
    el.querySelector<HTMLElement>(".progress")!.hidden = true;
    el.querySelector<HTMLElement>(".label")!.hidden = true;
    const err = el.querySelector<HTMLElement>(".error")!;
    err.hidden = false;
    err.textContent = message;
    el.querySelector<HTMLElement>(".actions")!.hidden = false;
    // in the dressed layout the message and the Back button go into the box in place of the tip and bar
    const box = el.querySelector<HTMLElement>(".loadbox");
    if (el.classList.contains("dressed") && box) {
      box.querySelector<HTMLElement>(".tip")!.hidden = true;
      box.append(err, el.querySelector(".actions")!);
    }
    el.querySelector<HTMLButtonElement>(".actions button")!.focus();
  }
}
