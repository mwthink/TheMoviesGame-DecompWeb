import { formatDate, type GameSpeed } from "../sim/core/GameClock.ts";

const ICONS: Record<GameSpeed, string> = {
  pause: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12"/><rect x="9.5" y="2" width="3.5" height="12"/></svg>`,
  play: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2 L13 8 L4 14 Z"/></svg>`,
  fast: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 2 L8 8 L1.5 14 Z"/><path d="M8 2 L14.5 8 L8 14 Z"/></svg>`,
};
const LABELS: Record<GameSpeed, string> = { pause: "Pause", play: "Play", fast: "Fast forward" };

/**
 * The game toolbar: the speed buttons (pause, play, fast), the in-game date and the studio's money. It only shows what it is given and reports
 * button presses; the clock itself is `sim/core/GameClock.ts`. Mounts into the slot of the menu bar (`MenuBar.toolbar`).
 */
export class GameToolbar {
  readonly element: HTMLElement;
  private readonly buttons = new Map<GameSpeed, HTMLButtonElement>();
  private readonly dateEl: HTMLElement;
  private readonly moneyEl: HTMLElement;

  constructor(onSpeed: (speed: GameSpeed) => void) {
    const el = document.createElement("div");
    el.className = "gametoolbar";
    el.innerHTML = `<div class="speed" role="group" aria-label="Game speed"></div><span class="date" title="Date"></span><span class="money" title="Cash"></span>`;
    this.element = el;
    const group = el.querySelector(".speed")!;
    for (const speed of ["pause", "play", "fast"] as GameSpeed[]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `speedbtn ${speed}`;
      b.title = LABELS[speed];
      b.setAttribute("aria-label", LABELS[speed]);
      b.innerHTML = ICONS[speed];
      b.addEventListener("click", () => onSpeed(speed));
      group.append(b);
      this.buttons.set(speed, b);
    }
    this.dateEl = el.querySelector(".date")!;
    this.moneyEl = el.querySelector(".money")!;
  }

  /** Highlight the active speed button. */
  setSpeed(speed: GameSpeed): void {
    for (const [s, b] of this.buttons) {
      b.classList.toggle("active", s === speed);
      b.setAttribute("aria-pressed", String(s === speed));
    }
  }

  /** Show the date (the game's day count) and the cash. Text is only written when it changed. */
  setStatus(days: number, cash: number | null): void {
    const date = formatDate(days);
    if (this.dateEl.textContent !== date) this.dateEl.textContent = date;
    const money = cash === null ? "" : formatMoney(cash);
    if (this.moneyEl.textContent !== money) this.moneyEl.textContent = money;
  }

  mount(parent: HTMLElement): void { parent.append(this.element); }
  dispose(): void { this.element.remove(); }
}

/** "$1,199,561", with a minus sign for debt. */
export function formatMoney(amount: number): string {
  const n = Math.round(Math.abs(amount)).toLocaleString("en-US");
  return `${amount < 0 ? "-" : ""}$${n}`;
}
