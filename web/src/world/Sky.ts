/**
 * The sky's variants (docs/SKY.md). They are **eras of the game's calendar, not times of day**. The landscape code (`Landscape_UpdateEraVariant`, orig 0x009CBA90) reads the current
 * game year (a callback set at boot, 0x0041FC60, that calls `Time_ToYears` on the global game clock: the date divided by 365), clamps it to at least 1900 and rounds
 * `(year - 1900) * 0.1` to a decade index; the variant is 0 for an index up to 5 (years before 1955), 1 for 6 to 9 (1955 to 1994) and 2 from 10 (1995 on). On a change it swaps the four
 * sky walls' textures (`sky_%02d_v%02d.dds`, orig 0x009CAE20) and the variant textures of the landscape objects (`%s_v%02d.dds`). With no callback the year defaults to 2000 (variant 2).
 */
export function skyVariantForYear(year: number): 0 | 1 | 2 {
  const clamped = Math.max(Math.fround(year), 1900);
  const x = Math.fround(Math.fround(clamped - 1900) * Math.fround(0.1)); // 32-bit floats, as the game computes it
  // the game rounds with the FPU's round-to-nearest-even
  const floor = Math.floor(x), diff = x - floor;
  const index = diff > 0.5 ? floor + 1 : diff < 0.5 ? floor : floor % 2 === 0 ? floor : floor + 1;
  return index > 9 ? 2 : index > 5 ? 1 : 0;
}

/** The year the game clock shows: its date in days over 365 (`Time_ToYears`, orig 0x0043B710). */
export function yearOfDate(days: number): number {
  return days / 365;
}
