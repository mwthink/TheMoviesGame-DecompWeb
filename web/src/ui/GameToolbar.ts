import { formatDate, type GameSpeed } from "../sim/core/GameClock.ts";
import { timelineX } from "../sim/ui/TimelineScale.ts";
import { clipMatchesEvent, type TimelineEvent } from "../sim/audio/RadioSpeech.ts";

const ICONS: Record<GameSpeed, string> = {
  pause: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12"/><rect x="9.5" y="2" width="3.5" height="12"/></svg>`,
  play: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2 L13 8 L4 14 Z"/></svg>`,
  fast: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 2 L8 8 L1.5 14 Z"/><path d="M8 2 L14.5 8 L8 14 Z"/></svg>`,
};
const LABELS: Record<GameSpeed, string> = { pause: "Pause", play: "Play", fast: "Fast forward" };
const TIPS: Record<GameSpeed, string> = {
  pause: "Pause: the date stops. Flags and the camera keep moving.",
  play: "Play: normal speed.",
  fast: "Fast forward: the date runs three times as fast.",
};

/**
 * The game toolbar: the speed buttons (pause, play, fast), the in-game date, the studio's money and the timeline strip of upcoming world events. It only shows what it is given and reports
 * button presses; the clock itself is `sim/core/GameClock.ts`. Mounts into the slot of the menu bar (`MenuBar.toolbar`).
 */
export class GameToolbar {
  readonly element: HTMLElement;
  private readonly buttons = new Map<GameSpeed, HTMLButtonElement>();
  private readonly dateEl: HTMLElement;
  private readonly moneyEl: HTMLElement;
  private readonly trackEl: HTMLElement;
  private readonly cardEl: HTMLElement;
  private now = 0;
  private hovered: { el: HTMLElement; tag: string; year: number } | null = null;
  private markers: { el: HTMLElement; tag: string; year: number; x: number | null }[] = [];

  constructor(onSpeed: (speed: GameSpeed) => void) {
    const el = document.createElement("div");
    el.className = "gametoolbar";
    el.innerHTML = `<div class="speed" role="group" aria-label="Game speed"></div><span class="date" data-tooltip="The date in the studio's world."></span><span class="money" data-tooltip="Your studio's cash."></span><div class="timeline" data-tooltip="The timeline: 1 year back to 20 years ahead. Dates near now are spread out; far ones bunch to the right."><div class="now"></div></div>`;
    this.element = el;
    const group = el.querySelector(".speed")!;
    for (const speed of ["pause", "play", "fast"] as GameSpeed[]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `speedbtn ${speed}`;
      b.dataset.tooltip = TIPS[speed];
      b.setAttribute("aria-label", LABELS[speed]);
      b.innerHTML = ICONS[speed];
      b.addEventListener("click", () => onSpeed(speed));
      group.append(b);
      this.buttons.set(speed, b);
    }
    this.dateEl = el.querySelector(".date")!;
    this.moneyEl = el.querySelector(".money")!;
    this.trackEl = el.querySelector(".timeline")!;
    const card = document.createElement("div");
    card.className = "tlcard";
    card.hidden = true;
    card.innerHTML = `<strong class="name"></strong><span class="when"></span><p></p>`;
    el.append(card);
    this.cardEl = card;
  }

  /** Highlight the active speed button. */
  setSpeed(speed: GameSpeed): void {
    for (const [s, b] of this.buttons) {
      b.classList.toggle("active", s === speed);
      b.setAttribute("aria-pressed", String(s === speed));
    }
  }

  /** The world events to show on the timeline strip (`timeline.csv`), replacing any shown before. */
  setTimelineEvents(events: readonly TimelineEvent[]): void {
    for (const m of this.markers) m.el.remove();
    this.markers = events.map((e) => {
      const el = document.createElement("div");
      el.className = "tlevent";
      el.hidden = true;
      // An empty tooltip stops the track's own bubble from showing over a dot (Tooltip.ts: the nearest `data-tooltip` wins); the card shows instead.
      el.dataset.tooltip = "";
      el.addEventListener("pointerenter", () => this.showCard({ el, tag: e.tag, year: e.year }));
      el.addEventListener("pointerleave", () => this.hideCard());
      this.trackEl.append(el);
      return { el, tag: e.tag, year: e.year, x: null };
    });
  }

  /**
   * Light the icon of the event a news clip is about while the clip plays (the original grows it from 16 to 24 px with a spinning glow until the voice stops,
   * `FUN_007A3110` and `WTimelineEventIcon_Update`, orig: 0x007A3D60). `null` clears it.
   */
  highlightNews(tag: string | null): void {
    for (const m of this.markers) m.el.classList.toggle("playing", tag !== null && clipMatchesEvent(tag, m.tag));
  }

  /** The small card under a hovered event dot: its name, date and what it is. */
  private showCard(m: { el: HTMLElement; tag: string; year: number }): void {
    this.hovered = m;
    this.fillCard(m);
    const card = this.cardEl;
    card.hidden = false;
    const r = m.el.getBoundingClientRect();
    const w = card.offsetWidth;
    card.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    card.style.top = `${r.bottom + 8}px`;
  }

  private hideCard(): void {
    this.hovered = null;
    this.cardEl.hidden = true;
  }

  private fillCard(m: { tag: string; year: number }): void {
    const c = this.cardEl;
    const set = (sel: string, text: string) => { const n = c.querySelector(sel)!; if (n.textContent !== text) n.textContent = text; };
    set(".name", m.tag.replace(/^TIMELINE_/, ""));
    set(".when", `${formatDate(m.year * 365)} · ${relativeYears(m.year - this.now)}`);
    set("p", "A world event. It shifts which genres the audience favours, and the radio reports it in the news.");
  }

  /** Place each event by its date (`sim/ui/TimelineScale.ts`). Only touches an event whose pixel changed. */
  private placeEvents(days: number): void {
    const now = days / 365;
    this.now = now;
    if (this.hovered) this.fillCard(this.hovered);
    const width = this.trackEl.clientWidth || 600;
    for (const m of this.markers) {
      const x = timelineX(m.year - now, width);
      if (x === m.x) continue;
      m.x = x;
      m.el.hidden = x === null;
      if (x !== null) m.el.style.left = `${x}px`;
    }
  }

  /** Show the date (the game's day count) and the cash. Text is only written when it changed. */
  setStatus(days: number, cash: number | null): void {
    const date = formatDate(days);
    if (this.dateEl.textContent !== date) this.dateEl.textContent = date;
    const money = cash === null ? "" : formatMoney(cash);
    if (this.moneyEl.textContent !== money) this.moneyEl.textContent = money;
    this.placeEvents(days);
  }

  mount(parent: HTMLElement): void { parent.append(this.element); }
  dispose(): void { this.element.remove(); }
}

/** How far off a date is, in words: "in 2 years", "3 months ago", "this month". */
export function relativeYears(yearsAhead: number): string {
  const months = Math.round(Math.abs(yearsAhead) * 12);
  if (months < 1) return "this month";
  const span = months >= 24 ? `${Math.round(months / 12)} years` : months === 12 ? "1 year" : months === 1 ? "1 month" : `${months} months`;
  return yearsAhead >= 0 ? `in ${span}` : `${span} ago`;
}

/** "$1,199,561", with a minus sign for debt. */
export function formatMoney(amount: number): string {
  const n = Math.round(Math.abs(amount)).toLocaleString("en-US");
  return `${amount < 0 ? "-" : ""}$${n}`;
}
