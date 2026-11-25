import { gameStrings, randomLoadingPicture } from "./frontEndArt.ts";
import { LoadingView } from "./LoadingView.ts";
import { pickTip } from "./loadingTips.ts";
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
 * tip, still inside the box, our own progress bar and current-step line (`LoadingView`, also used by the loading-screen lab). Without the game files (or while they are still
 * being read) it falls back to the plain heading and bar.
 */
export class LoadingScreen<T> implements Screen {
  private el: HTMLElement | null = null;
  private cancelled = false;
  private readonly view = new LoadingView();
  private dressed = false;
  /** The error the task failed with, handed to `onError` when the player presses Back. */
  private failure = "";
  /** The last progress report, kept so the dressed view can start where the plain one is. */
  private last: { fraction: number | null; label: string } = { fraction: 0, label: "Starting" };

  constructor(
    private readonly container: HTMLElement,
    private readonly task: LoadTask<T>,
    private readonly onDone: (result: T) => void,
    private readonly onError: (message: string) => void,
  ) {}

  enter(): void {
    this.el = mountScreen(this.container, "menu loading");
    this.view.element.hidden = true;
    this.el.append(this.view.element);
    this.el.insertAdjacentHTML("beforeend", `
      <div class="plain">
        <h2 class="plainheading">Loading</h2>
        <div class="progress" role="progressbar" aria-label="Loading progress" aria-valuemin="0" aria-valuemax="100">
          <div class="fill"></div>
        </div>
        <p class="label">Starting</p>
        <p class="error" hidden></p>
        <div class="actions" hidden><button type="button">Back</button></div>
      </div>`);
    this.el.querySelector<HTMLButtonElement>(".plain .actions button")!.addEventListener("click", () => this.onError(this.failure));
    void this.dress();
    void this.run();
  }

  exit(): void {
    this.cancelled = true;
    if (this.el) { void unmountScreen(this.el); this.el = null; }
  }

  /** Put the picture and the tip in when they are ready, and show the dressed view in place of the plain one. */
  private async dress(): Promise<void> {
    const [picture, strings] = await Promise.all([randomLoadingPicture(), gameStrings()]);
    const el = this.el;
    if (!el || this.cancelled || !picture) return;
    this.view.setPicture(picture.canvas);
    this.view.setTip(pickTip(strings));
    this.view.setProgress(this.last.fraction, this.last.label);
    this.view.element.hidden = false;
    el.querySelector<HTMLElement>(".plain")!.hidden = true;
    el.classList.add("dressed");
    this.dressed = true;
  }

  private async run(): Promise<void> {
    const progress: Progress = { report: (fraction, label) => this.show(fraction, label) };
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
    this.last = { fraction, label };
    this.view.setProgress(fraction, label);
    const bar = el.querySelector<HTMLElement>(".plain .progress")!;
    const fill = el.querySelector<HTMLElement>(".plain .fill")!;
    bar.classList.toggle("indeterminate", fraction === null);
    bar.setAttribute("aria-valuenow", fraction === null ? "" : String(Math.round(fraction * 100)));
    fill.style.width = fraction === null ? "" : `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    el.querySelector<HTMLElement>(".plain .label")!.textContent = label;
  }

  private fail(message: string): void {
    const el = this.el!;
    this.failure = message;
    if (this.dressed) { this.view.showError(message, () => this.onError(message)); return; }
    el.querySelector<HTMLElement>(".plain .progress")!.hidden = true;
    el.querySelector<HTMLElement>(".plain .label")!.hidden = true;
    const err = el.querySelector<HTMLElement>(".plain .error")!;
    err.hidden = false;
    err.textContent = message;
    el.querySelector<HTMLElement>(".plain .actions")!.hidden = false;
    el.querySelector<HTMLButtonElement>(".plain .actions button")!.focus();
  }
}
