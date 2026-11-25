import type { Tip } from "./loadingTips.ts";
import { LOADING_BOX } from "./loadingTips.ts";

/**
 * How the loading screen is laid out (docs/LOADING_SCREENS.md). The defaults reproduce the original's arrangement: the picture as large as fits, our text in the
 * speech-bubble box that is part of the picture, the progress bar under the text. The loading-screen lab (`LoadingGalleryScreen`) changes these live.
 */
export interface LoadingLayout {
  /** The text box as fractions of the picture (the baked box is `LOADING_BOX`). */
  box: { x: number; y: number; width: number; height: number };
  /** Multiplies the text sizes (1 = the default, sized from the picture). */
  textScale: number;
  headingColour: string;
  bodyColour: string;
  /** Draw our own panel behind the text, over the picture's baked box (to resize or recolour the box). */
  ownFill: { enabled: boolean; colour: string; opacity: number; radius: number };
  /** `contain`: the whole picture is visible; `cover`: the picture fills the window and its edges are cropped. */
  fit: "contain" | "cover";
}

export const DEFAULT_LOADING_LAYOUT: Readonly<LoadingLayout> = {
  box: { ...LOADING_BOX },
  textScale: 1,
  headingColour: "#17223a",
  bodyColour: "#000000",
  ownFill: { enabled: false, colour: "#a6b7d5", opacity: 1, radius: 2 },
  fit: "contain",
};

/**
 * The dressed loading screen as one DOM element: the picture, a box with a tip in it, and under the tip a progress bar and the current-step line. Used by the real loading
 * screen and by the lab; everything is set through methods so both drive it the same way.
 */
export class LoadingView {
  readonly element: HTMLElement;
  private readonly box: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly label: HTMLElement;
  private readonly tipEl: HTMLElement;
  private readonly error: HTMLElement;
  private readonly actions: HTMLElement;
  private picture: HTMLCanvasElement | null = null;

  constructor() {
    const el = document.createElement("div");
    el.className = "loadpic";
    el.innerHTML = `
      <div class="loadbox">
        <div class="tip"><h3></h3><p></p></div>
        <div class="loadprogress">
          <div class="progress" role="progressbar" aria-label="Loading progress" aria-valuemin="0" aria-valuemax="100"><div class="fill"></div></div>
          <p class="label"></p>
        </div>
        <p class="error" hidden></p>
        <div class="actions" hidden><button type="button">Back</button></div>
      </div>`;
    this.element = el;
    this.box = el.querySelector(".loadbox")!;
    this.bar = el.querySelector(".progress")!;
    this.fill = el.querySelector(".fill")!;
    this.label = el.querySelector(".label")!;
    this.tipEl = el.querySelector(".tip")!;
    this.error = el.querySelector(".error")!;
    this.actions = el.querySelector(".actions")!;
    this.setLayout(DEFAULT_LOADING_LAYOUT);
  }

  /** The background picture (null removes it). */
  setPicture(canvas: HTMLCanvasElement | null): void {
    this.picture?.remove();
    this.picture = canvas;
    if (canvas) {
      canvas.className = "picture";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Loading screen picture");
      this.element.prepend(canvas);
    }
  }

  /** The tip in the box (null leaves the box with just the bar). */
  setTip(tip: Pick<Tip, "heading" | "body"> | null): void {
    this.tipEl.hidden = !tip;
    if (!tip) return;
    const h = this.tipEl.querySelector("h3")!;
    h.textContent = tip.heading;
    h.hidden = !tip.heading;
    this.tipEl.querySelector("p")!.textContent = tip.body;
  }

  /** The bar (a fraction 0..1, or null for the sweeping indeterminate bar) and the line under it. */
  setProgress(fraction: number | null, label: string): void {
    this.bar.classList.toggle("indeterminate", fraction === null);
    this.bar.setAttribute("aria-valuenow", fraction === null ? "" : String(Math.round(fraction * 100)));
    this.fill.style.width = fraction === null ? "" : `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    this.label.textContent = label;
  }

  /** Replace the tip and bar with an error message and a Back button. */
  showError(message: string, onBack: () => void): void {
    this.tipEl.hidden = true;
    this.bar.parentElement!.hidden = true;
    this.error.hidden = false;
    this.error.textContent = message;
    this.actions.hidden = false;
    const button = this.actions.querySelector("button")!;
    button.onclick = onBack;
    button.focus();
  }

  /** Apply a layout: the box rectangle, text scale and colours, our own fill, and how the picture fits the window. */
  setLayout(l: LoadingLayout): void {
    const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
    this.box.style.left = pct(l.box.x);
    this.box.style.top = pct(l.box.y);
    this.box.style.width = pct(l.box.width);
    this.box.style.height = pct(l.box.height);
    this.box.style.setProperty("--ts", String(l.textScale));
    this.box.style.setProperty("--heading", l.headingColour);
    this.box.style.setProperty("--body", l.bodyColour);
    this.box.style.background = l.ownFill.enabled ? withOpacity(l.ownFill.colour, l.ownFill.opacity) : "";
    this.box.style.borderRadius = l.ownFill.enabled ? `${l.ownFill.radius}cqw` : "";
    this.element.classList.toggle("cover", l.fit === "cover");
  }
}

/** "#rrggbb" and an opacity as an rgba() colour. */
export function withOpacity(hex: string, opacity: number): string {
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) || 0;
  return `rgba(${n(1)}, ${n(3)}, ${n(5)}, ${Math.min(1, Math.max(0, opacity))})`;
}
