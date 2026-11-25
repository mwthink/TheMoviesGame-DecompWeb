// The AI studio's release decision: when a computer-controlled studio makes a movie.
//
// From CStudioAI_DecideAndReleaseMovie (0x5154A0), with the mean and RMS from CStudioAI_MeanSuccessDifference (0x5148D0) and
// CStudioAI_RmsSuccessDifference (0x514950). Derivation: docs/MOVIE_SUCCESS.md 3m. Tuning: Data/rule/aistudios.csv.

const f32 = Math.fround;

/** Data/rule/aistudios.csv, the rows the decision reads. */
export interface AiRules {
  differenceTarget: number; // "Difference target"
  differenceMultiplier: number; // "Difference multiplier"
  deviationTarget: number; // "Deviation target"
  deviationMultiplier: number; // "Deviation multiplier"
  /** "Minimum time between releases" (182.5 days) */
  minYearsBetweenReleases: number;
  /** "Maximum time between releases" (730 days) */
  maxYearsBetweenReleases: number;
  /** "Movie release desire threshold" */
  releaseThreshold: number;
}

export function defaultAiRules(): AiRules {
  return { differenceTarget: f32(0.1), differenceMultiplier: 3, deviationTarget: f32(0.2), deviationMultiplier: 12, minYearsBetweenReleases: 0.5, maxYearsBetweenReleases: 2, releaseThreshold: 0.5 };
}

const DEFAULT = defaultAiRules();

/** The mean and root mean square of every AI studio's success difference (+0x298), over all studios in the list (including ones that never decide). */
export interface SuccessDifferenceStats {
  mean: number;
  rms: number;
}

/** orig: 0x005148D0  orig: 0x00514950 */
export function computeStats(successDifferences: readonly number[]): SuccessDifferenceStats {
  if (successDifferences.length === 0) return { mean: 0, rms: 0 };
  let sum = 0, sq = 0;
  for (const v of successDifferences) {
    sum += v;
    sq += v * v;
  }
  return { mean: sum / successDifferences.length, rms: Math.sqrt(sq / successDifferences.length) };
}

/**
 * "Desire": how far the studio group is from the target spread, scaled by this studio's own difference, clamped to 0..1:
 * clamp01((differenceTarget - mean) * differenceMultiplier + (deviationTarget - rms) * deviationMultiplier * ownDifference)
 */
export function releaseDesire(ownDifference: number, stats: SuccessDifferenceStats, r: AiRules = DEFAULT): number {
  const v = (r.differenceTarget - stats.mean) * r.differenceMultiplier + (r.deviationTarget - stats.rms) * r.deviationMultiplier * ownDifference;
  return Math.min(1, Math.max(0, v));
}

/**
 * The release score: 0 until minYearsBetweenReleases after the last release, then desire ramps in linearly over half of (max - min) years, then rises
 * from desire to 1 over the other half. yearsSinceLastRelease is the game clock minus the studio's last release time.
 */
export function releaseScore(desire: number, yearsSinceLastRelease: number, r: AiRules = DEFAULT): number {
  const elapsed = yearsSinceLastRelease - r.minYearsBetweenReleases;
  const half = (r.maxYearsBetweenReleases - r.minYearsBetweenReleases) * 0.5;
  if (elapsed < 0) return 0;
  if (half <= 0) return desire;
  if (elapsed < half) return (desire * elapsed) / half;
  return desire + ((1 - desire) * (elapsed - half)) / half;
}

/**
 * A studio releases a movie when the score is above the threshold. Verified: 9 logged releases scored 0.499-0.512 and the highest of 200 decisions
 * without a release 0.489, against the 0.5 threshold, using the game's own mean / rms (one release is 0.001 below the threshold, within the precision
 * of the logged time). orig: 0x005154A0 verified
 */
export function shouldRelease(ownDifference: number, stats: SuccessDifferenceStats, yearsSinceLastRelease: number, r: AiRules = DEFAULT): boolean {
  return releaseScore(releaseDesire(ownDifference, stats, r), yearsSinceLastRelease, r) > r.releaseThreshold;
}
