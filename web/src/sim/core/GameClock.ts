/**
 * The game's calendar clock and its fixed-timestep driver (docs/MAIN_LOOP.md, docs/CLASS_NOTES.md "GameClock").
 *
 * [read] `Timestep_NextTick` (0x566B10): an accumulator takes `frame time * game speed` and yields one simulation tick for every 0.1 s it holds,
 * so the simulation runs at 10 ticks per second of speed-scaled time. [read] `GameClock_Update` / `GameClock_AdvanceTick` (orig: 0x0043B8C0 / 0x0043B760): each
 * tick adds 1 / ticksPerDay of a day to the date; when the whole-day part rolls over, the weekday advances (+1 mod 7).
 *
 * Pausing is "the accumulator receives nothing": the game itself does not stop drawing. Things driven by rendered frames (the flags,
 * `AutoAnimation.ts`) keep going while the clock is paused.
 */

/** Seconds of speed-scaled time per simulation tick. */
export const TICK_SECONDS = 0.1;

/** Days of the (leap-less) 365-day year, January first. The game's date is a float of days at 365 per year (docs/SAVE_FORMAT.md). */
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Simulation ticks per game day for a date's year (`GameClock_UpdateTicksPerDay`, 0x43B800). [read] the constants 4, 20, 1900, 1960 and 0.05776 and
 * that the pace is constant from 1960 and an exponential of the year before; [guess] the curve: a geometric blend from 4 ticks (1900) to 20 (1960), and
 * 20 afterwards. The decompile lost the x87 result, so the real curve may differ (and the direction is unconfirmed): `ticksPerDay` can be set directly.
 */
export function ticksPerDayForYear(year: number): number {
  if (year >= 1960) return 20;
  if (year <= 1900) return 4;
  return Math.round(4 * Math.pow(5, (year - 1900) / 60));
}

/** A game date broken into calendar parts. */
export interface CalendarDate { year: number; month: number; day: number; hour: number; minute: number; }

/** Split the game's day count (365 per year, 1 Jan 1920 = 1920 x 365; the fraction is the time of day) into year, month (0-11), day of month (1-31), hour and minute. */
export function calendarDate(days: number): CalendarDate {
  const year = Math.floor(days / 365);
  const dayOfYear = Math.floor(days - year * 365);
  let month = 0, rest = dayOfYear;
  while (month < 11 && rest >= MONTH_DAYS[month]!) { rest -= MONTH_DAYS[month]!; month++; }
  const frac = days - Math.floor(days);
  const minutes = Math.floor(frac * 1440);
  return { year, month, day: rest + 1, hour: Math.floor(minutes / 60), minute: minutes % 60 };
}

/** "4 Jul 1960". */
export function formatDate(days: number): string {
  const c = calendarDate(days);
  return `${c.day} ${MONTH_NAMES[c.month]} ${c.year}`;
}

/** The speeds of the toolbar. `pause` is speed 0. [guess] fast = 3x; the original's speed buttons have not been measured. */
export type GameSpeed = "pause" | "play" | "fast";
export const SPEED_FACTOR: Record<GameSpeed, number> = { pause: 0, play: 1, fast: 3 };

export class GameClock {
  /** The date: days at 365 per year, with the time of day as the fraction. */
  date: number;
  /** 0 = Sunday. Starts from the date's own count (a day number modulo 7 has no meaning in the original, so this starts at 0 unless given). */
  weekday: number;
  /** Simulation ticks run so far. */
  ticks = 0;
  ticksPerDay: number;
  speed: GameSpeed = "play";
  /** The accumulator of speed-scaled seconds, below one tick. */
  private accumulator = 0;

  constructor(date: number, weekday = 0) {
    this.date = date;
    this.weekday = weekday;
    this.ticksPerDay = ticksPerDayForYear(Math.floor(date / 365));
  }

  /**
   * Feed one rendered frame's real time; returns how many simulation ticks to run. The original runs at most one per pass of its main loop (the
   * accumulator keeps the rest); here the count is capped at 5 per frame so a long stall cannot lock up the page.
   */
  advance(frameSeconds: number): number {
    this.accumulator += Math.max(0, frameSeconds) * SPEED_FACTOR[this.speed];
    let n = 0;
    while (this.accumulator >= TICK_SECONDS && n < 5) {
      this.accumulator -= TICK_SECONDS;
      this.tick();
      n++;
    }
    if (n === 5) this.accumulator = Math.min(this.accumulator, TICK_SECONDS); // drop the backlog
    return n;
  }

  /** `GameClock_AdvanceTick`: one simulation tick. */
  tick(): void {
    const before = Math.floor(this.date);
    this.date += 1 / this.ticksPerDay;
    this.ticks++;
    if (Math.floor(this.date) !== before) {
      this.weekday = (this.weekday + 1) % 7;
      this.ticksPerDay = ticksPerDayForYear(Math.floor(this.date / 365));
    }
  }
}
