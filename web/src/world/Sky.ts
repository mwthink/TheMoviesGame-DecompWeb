/**
 * The sky's time-of-day variants (docs/SKY.md). The game's sky box textures come in three variants (`sky_01_v00` .. `sky_04_v02`) and the landscape code picks one from the hour:
 * orig 0x009CBA90 compares the rounded time-of-day value with 6 and 10: variant 0 up to hour 5 (night), 1 for hours 6 to 9 (morning), 2 from hour 10 (day); when the variant changes it
 * swaps the four sky-wall textures (0x009CAE20, `sky_%02d_v%02d.dds`) and the variant textures of the landscape objects (`%s_v%02d.dds`).
 */
export function skyVariantForHour(hour: number): 0 | 1 | 2 {
  return hour < 10 ? (hour > 5 ? 1 : 0) : 2;
}
