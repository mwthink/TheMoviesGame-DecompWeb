/**
 * The timeline's award and research icons (docs/AUDIO.md, "Timeline icons: what they do"). Which dates the icons stand at and when they show; the strip itself is
 * `ui/GameToolbar.ts` and where a date sits is `TimelineScale.ts`. Dates are the game's days (365 to the year), as in the save.
 *
 * Plain data and rules, no browser APIs.
 */

import { PAST_YEARS } from "./TimelineScale.ts";

const DAYS = 365;

/** What a save says about the awards clock (docs/SAVE_FORMAT.md): the previous ceremony's date, the first awards year, the game type, and `global.ini` `[awards] interval`. */
export interface AwardsClock {
  /** `PreviousAwardsDate.YearInDays`: the last ceremony's date in days (a new studio: its start date). */
  previous: number;
  /** `FirstAwardsYear`: no ceremony before it (a new game: the start year plus the interval). */
  firstYear: number;
  /** Years between ceremonies: `global.ini` `[awards] interval`, 5. */
  interval: number;
  /** The awards run in a new game (game type 1) and an add-on quick start (3), not in the tutorial (0) or the sandbox (2). */
  enabled: boolean;
}

export type TimelineIconKind = "award" | "research";

export interface TimelineIcon {
  /** Stable across ticks, so the strip keeps one element per icon. */
  id: string;
  kind: TimelineIconKind;
  /** The icon's date as a decimal year. */
  year: number;
  /** The picture to draw: `ui/timeline_award.dds`, `timeline_award2.dds` or `timeline_re_costume.dds`. */
  picture: "award" | "award2" | "research";
  /** A short name for the hover card. */
  title: string;
  /** What the card says about it. */
  detail: string;
}

/** Whether the awards run for a game type (`CSandbox` option 6: 0 tutorial, 1 new game, 2 sandbox, 3 add-on quick start). orig: `FUN_0085bb10` (0x0085BB10) reads `*(DAT_0104A974 + 0x78)` as 1.0 or 3.0. */
export function awardsEnabled(gameType: number): boolean {
  return gameType === 1 || gameType === 3;
}

/**
 * The award icons at a game date: up to three, the previous ceremony, the next and the one after. orig: `FUN_00797c50` and the `Timeline_Constructor` (0x0079F4F0) make
 * three icons of kind 0, 1 and 2 (`FUN_007A2790`): kind 0 stands at `FUN_0085BAE0` (the previous date), kind 1 at `FUN_0085C530` (the previous date plus the interval
 * in years) and kind 2 at that date's year rounded plus the interval. The previous-ceremony icon waits for the first awards year (`FirstAwardsYear <= round(year)`).
 * The picture is `ui/timeline_award.dds`; `WTimelineAwardsIcon_Tick` (0x007A2B00) switches to `timeline_award2.dds` from 2004 to 2009 (`FUN_0085C570` returns 2005 when the awards
 * run: `2005 <= year + 1` and `year < 2005 + interval`).
 * [guess] The game holds a ceremony when the date passes the next one and moves the previous date on (`FUN_00860580`); the web port has no ceremonies, so the clock is rolled
 * forward here: the previous date moves by whole intervals until the next one is ahead.
 */
export function awardIcons(clock: AwardsClock, nowDays: number): TimelineIcon[] {
  if (!clock.enabled || !(clock.interval > 0)) return [];
  const step = clock.interval * DAYS;
  const passed = Math.max(0, Math.floor((nowDays - clock.previous) / step));
  const previous = clock.previous + passed * step;
  const next = previous + step;
  const nextNext = Math.round(next / DAYS) * DAYS + step; // `Math_RoundToInt64_A` of the year, plus the interval
  const yearNow = Math.round(nowDays / DAYS);
  const late = yearNow >= 2004 && yearNow < 2005 + clock.interval;
  const picture = late ? "award2" : "award";
  const out: TimelineIcon[] = [];
  const make = (slot: string, days: number, title: string, detail: string) => out.push({ id: `award:${slot}`, kind: "award", year: days / DAYS, picture, title, detail });
  if (clock.firstYear <= yearNow) make("previous", previous, "Awards ceremony", "The last awards ceremony.");
  make("next", next, "Awards ceremony", "The next awards ceremony: the best star, studio and movie of the years since the last are honoured, and the winners get a bonus.");
  make("after", nextNext, "Awards ceremony", "The ceremony after the next.");
  return out;
}

/** A research pack as a save has it (`CResearchPack`): its name, whether the player has it, and the date it unlocks for the player. */
export interface ResearchPackDate {
  name: string;
  /** `IsAvailableToPlayer`. */
  unlocked: boolean;
  /** `PlayerUnlockDate`, in days; 0 when the pack has none. */
  unlockDate: number;
}

/** Days before its date that a research icon appears. orig: `FUN_0079EBB0` (0x0079EBB0) makes the icon when `round(date) - round(now) < 15` (0xf). [inferred] days, and that the date is the first operand. */
export const RESEARCH_LEAD_DAYS = 15;

/**
 * The research icons at a game date: a pack stands at its unlock date for the player (`PlayerUnlockDate`) and shows from 14 days before it; after that it stays until it is
 * more than a year back (the bar's left edge). orig: `Timeline_UpdateNoduleIcons` (0x007A14A0) and `FUN_0079EBB0` for each `CNoduleResearchPack`; every research
 * icon uses `ui/timeline_re_costume.dds` whatever the pack is. The hover bubble (`FUN_007A8080`) names the pack and says either `SITT_RESEARCHPACK_UNLOCKDATE` (with the
 * date) or `SITT_RESEARCHPACK_UNLOCKED`.
 * [guess] That the nodule's date is `PlayerUnlockDate` (the bubble's date) and that a nodule exists for every pack with a date.
 */
export function researchIcons(packs: readonly ResearchPackDate[], nowDays: number): TimelineIcon[] {
  const out: TimelineIcon[] = [];
  for (const p of packs) {
    // a date more than the bar's year back would be drawn off its left edge (`timelineX` is null), so it is not made
    if (!(p.unlockDate > 0) || p.unlockDate - nowDays >= RESEARCH_LEAD_DAYS || p.unlockDate < nowDays - PAST_YEARS * DAYS) continue;
    const name = p.name.replace(/_/g, " ");
    out.push({
      id: `research:${p.name}`,
      kind: "research",
      year: p.unlockDate / DAYS,
      picture: "research",
      title: `Research: ${name}`,
      detail: p.unlocked || p.unlockDate <= nowDays ? "Unlocked." : "Becomes available to research.",
    });
  }
  return out;
}
