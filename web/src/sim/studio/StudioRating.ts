// A studio's rating (the number behind the studio stars and the Studio milestone achievement).
//
// From CStudio_ComputeStarRating (0x50AB70, which the project's names call a star rating but which belongs to the studio) and
// CStudio_GetDecayedReputation (0x50A860). Derivation and measurements: docs/STUDIO.md 3aw.

const f32 = Math.fround;
const clamp = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The weights of the five terms. The three at 0xE521B4..0xE521BC were read from the executable (0.239, 0.239, 0.144); the other two were fitted to the
 * logged ratings (0.1447 and 0.2386, i.e. the same 0.144 and 0.239) because their constants have not been read.
 */
export interface StudioRatingTuning {
  weightAppearance: number;
  weightReputation: number;
  /** 0xE521B4 */
  weightMoney: number;
  /** 0xE521B8 */
  weightStarPower: number;
  /** 0xE521BC */
  weightAwards: number;
  /** decay constant 0xE52188 = ln 2 / 5 = 0.138629 */
  reputationHalfLifeYears: number;
}

export function defaultStudioRatingTuning(): StudioRatingTuning {
  return { weightAppearance: f32(0.144), weightReputation: f32(0.239), weightMoney: f32(0.239), weightStarPower: f32(0.239), weightAwards: f32(0.144), reputationHalfLifeYears: 5 };
}

const DEFAULT = defaultStudioRatingTuning();

/** The components, each 0..1. */
export interface StudioComponents {
  /** studio +0x12C */
  appearance: number;
  /** the decayed reputation */
  reputation: number;
  /** CStudio_GetMoneyRatingComponent (0x50CFE0) */
  money: number;
  /** CStudio_GetStarPowerRatingComponent (0x50FC90) */
  starPower: number;
  /** CStudio_GetAwardsRatingComponent (0x50D8E0): awards owned * 0.1695 */
  awards: number;
}

/**
 * rating = clamp01(...clamp01(clamp01(w_app * appearance + w_rep * reputation) + w_money * money) + w_star * starPower) + w_awards * awards), clamping
 * after each addition. Verified: 27 logged studio rows; the sequential clamped sum matches the logged rating to 1e-4 in 26 of them and to 1e-3 in the
 * other, where the cached rating was a tick older than the components. orig: 0x0050AB70 verified
 */
export function computeStudioRating(c: StudioComponents, t: StudioRatingTuning = DEFAULT): number {
  let s = f32(clamp(f32(t.weightAppearance * c.appearance)));
  s = f32(clamp(f32(s + f32(t.weightReputation * c.reputation))));
  s = f32(clamp(f32(s + f32(t.weightMoney * c.money))));
  s = f32(clamp(f32(s + f32(t.weightStarPower * c.starPower))));
  return f32(clamp(f32(s + f32(t.weightAwards * c.awards))));
}

/**
 * CStudio_GetDecayedReputation: the stored reputation (+0x138) fades exponentially from the year it was stored (+0x13C).
 * Verified: 27 logged rows within 1e-4 of base * exp(-ln2/5 * years). orig: 0x0050A860 verified
 */
export function decayedReputation(stored: number, yearsSinceStored: number, t: StudioRatingTuning = DEFAULT): number {
  const k = Math.log(2) / t.reputationHalfLifeYears;
  return f32(clamp(f32(stored * Math.exp(-k * yearsSinceStored))));
}
