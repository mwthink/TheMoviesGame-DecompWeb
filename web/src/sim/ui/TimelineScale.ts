/**
 * Where a date sits on the timeline bar (docs/AUDIO.md, "Timeline icons: where they come from and where they sit").
 *
 * orig: `FUN_00793f50` (0x00793F50), called by `CNoduleEvent_SpawnOrUpdateIcon` (0x0079EF30). The position depends only on the date: with `y` the date minus
 * the current game time in years, "now" sits `NOW_OFFSET` px from the bar's left edge, the bar shows `PAST_YEARS` back and `FUTURE_YEARS` ahead, and the
 * distance from "now" follows `1 - (y+1)^-0.5` (future) or `1 - (1-y)^-0.5` (past), normalised to the span's end. Not linear: near dates are spread, far ones bunch.
 * [inferred] that the constants are years (the function is `Time_ToYears` of a time difference); not logged from the running game.
 */

/** Pixels from the bar's left edge to "now". orig: `DAT_00e59c74` = 128. */
export const NOW_OFFSET = 128;
/** Years ahead that reach the right edge. orig: `DAT_00e59c78` = 20, plus the 1 added before the power. */
export const FUTURE_YEARS = 20;
/** Years back that reach the left edge. orig: `DAT_00e59c7c` = 1. */
export const PAST_YEARS = 1;

/**
 * The x of a date on a bar `width` px wide (left edge 0), whole pixels like the original, or null when the date is beyond the bar (more than 20 years
 * ahead or 1 year back; the original puts such an icon at x = -32).
 */
export function timelineX(yearsAhead: number, width: number): number | null {
  const x0 = NOW_OFFSET;
  if (yearsAhead >= 0) {
    const f = (1 - Math.pow(yearsAhead + 1, -0.5)) / (1 - Math.pow(FUTURE_YEARS + 1, -0.5));
    if (f > 1) return null;
    return Math.round(x0 + (width - x0) * f);
  }
  const f = (1 - Math.pow(1 - yearsAhead, -0.5)) / (1 - Math.pow(PAST_YEARS + 1, -0.5));
  if (f > 1) return null;
  return Math.round(x0 - x0 * f);
}
