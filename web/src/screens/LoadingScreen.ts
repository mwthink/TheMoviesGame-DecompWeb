import { mountScreen, unmountScreen, type Screen } from "./Screen.ts";

/** How a load task reports progress: a fraction 0..1 when known, null for an indeterminate bar, and a line of text. */
export interface Progress {
  report(fraction: number | null, label: string): void;
}

/** A piece of work that yields the finished result, reporting as it goes. */
export type LoadTask<T> = (progress: Progress) => Promise<T>;

/** Loading screen: runs a task and shows a progress bar until it finishes, then hands over the result (or the error). */
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
      <h2>Loading</h2>
      <div class="progress" role="progressbar" aria-label="Loading progress" aria-valuemin="0" aria-valuemax="100">
        <div class="fill"></div>
      </div>
      <p class="label">Starting</p>
      <p class="error" hidden></p>
      <div class="actions" hidden><button type="button">Back</button></div>`;
    this.el.querySelector<HTMLButtonElement>(".actions button")!.addEventListener("click", () => this.onError(""));
    void this.run();
  }

  exit(): void {
    this.cancelled = true;
    if (this.el) { void unmountScreen(this.el); this.el = null; }
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
    el.querySelector<HTMLButtonElement>(".actions button")!.focus();
  }
}
