/**
 * Tooltips, after the original's (docs/TOOLTIPS.md).
 *
 * The original has a singleton tooltip window (`WToolTip`): any window can carry tooltip text (`WWindow_SetTooltipText`, orig 0x00740DC0), and when the
 * pointer rests on it the tooltip window shows the text on a `ui/tooltip2.dds` backdrop, wrapped to fit the screen, next to the pointer. It appears only
 * once the pointer has been still for a moment and then fades in (`Tooltip_UpdateHoverStillnessFade`, orig 0x0078EB40).
 *
 * This port keeps those rules (text carried by the element, a stillness delay and fade-in, wrapping, staying on screen) but shows the text in a bubble at
 * the bottom right of the screen that a click dismisses, as asked; the original's placement beside the pointer is a styling choice, not behaviour.
 */

/** UI ticks per second the original's windows run at (`Timestep_NextTick`, docs/MAIN_LOOP.md). */
export const UI_TICK_SECONDS = 0.1;

/**
 * The hover-stillness fade, orig: 0x0078EB40 `Tooltip_UpdateHoverStillnessFade`, run once per UI tick: when the pointer is where it was on the last tick
 * the value rises by 0.1 up to 1.0; when it moved the value restarts at -0.2. The tooltip's opacity is the value (nothing while it is below 0), so it appears
 * after 0.2 s of stillness and is fully opaque after 1.2 s.
 */
export class HoverStillness {
  /** The raw value, -0.2 .. 1. */
  value = -0.2;
  private x = NaN;
  private y = NaN;

  /** One UI tick with the pointer at (x, y). */
  tick(x: number, y: number): void {
    if (x === this.x && y === this.y) {
      this.value = Math.min(1, this.value + 0.1);
    } else {
      this.x = x;
      this.y = y;
      this.value = -0.2;
    }
  }

  /** Opacity 0..1. */
  get opacity(): number { return Math.max(0, this.value); }
}

/** Wrap width for the bubble: the original sizes its HTML table to 90 % of the room left on screen (`WToolTip_PositionAndSize`, orig 0x0073B200). */
export function tooltipWidth(availablePx: number): number {
  return Math.max(120, Math.floor(availablePx * 0.9));
}

/**
 * The tooltip bubble. Elements carry `data-tooltip="text"`; `attach` listens on a root for the pointer resting on one. `show(text)` / `hide()` let code
 * (the 3D view) set the text for things that are not elements. A click on the bubble dismisses it until the pointer moves to another tooltip target.
 */
export class Tooltip {
  readonly element: HTMLElement;
  private readonly stillness = new HoverStillness();
  private timer: number | undefined;
  private pointer = { x: 0, y: 0 };
  /** The text wanted by what the pointer is on (null = nothing). */
  private wanted: string | null = null;
  /** Text the player dismissed; it stays hidden until something else is hovered. */
  private dismissed: string | null = null;
  private programmatic: string | null = null;
  private readonly onMove = (e: PointerEvent) => {
    this.pointer = { x: e.clientX, y: e.clientY };
    const el = (e.target as Element | null)?.closest?.("[data-tooltip]");
    this.setWanted(el ? el.getAttribute("data-tooltip") : this.programmatic);
  };

  constructor() {
    const el = document.createElement("div");
    el.className = "tooltip";
    el.setAttribute("role", "status");
    el.hidden = true;
    el.innerHTML = `<p></p><button type="button" aria-label="Dismiss tip">×</button>`;
    el.addEventListener("click", () => this.dismiss());
    this.element = el;
  }

  /** Listen for the pointer on `root` and start the UI tick. */
  attach(root: HTMLElement): void {
    root.append(this.element);
    window.addEventListener("pointermove", this.onMove);
    this.timer = window.setInterval(() => this.tick(), UI_TICK_SECONDS * 1000);
  }

  dispose(): void {
    window.removeEventListener("pointermove", this.onMove);
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.element.remove();
  }

  /** Show text that belongs to something that is not an element (an object in the 3D view); `null` clears it. */
  show(text: string | null): void {
    this.programmatic = text;
    this.setWanted(text);
  }

  hide(): void { this.show(null); }

  private setWanted(text: string | null): void {
    if (text !== this.wanted) {
      this.wanted = text;
      this.stillness.value = -0.2; // a new target waits again
      if (text !== this.dismissed) this.dismissed = null;
    }
  }

  private dismiss(): void {
    this.dismissed = this.wanted;
    this.render(0);
  }

  /** One UI tick: advance the stillness fade and draw. */
  private tick(): void {
    this.stillness.tick(this.pointer.x, this.pointer.y);
    this.render(this.stillness.opacity);
  }

  private render(opacity: number): void {
    const text = this.wanted && this.wanted !== this.dismissed ? this.wanted : null;
    const el = this.element;
    if (!text || opacity <= 0) { if (!el.hidden) el.hidden = true; return; }
    const p = el.querySelector("p")!;
    if (p.textContent !== text) p.textContent = text;
    el.style.maxWidth = `${tooltipWidth(window.innerWidth - 20)}px`;
    el.style.opacity = String(opacity);
    el.hidden = false;
  }
}
