// Movie quality rating: how a shot's and a whole movie's quality (0..1) is computed.
//
// From CQualityRating_Compute and its helpers, and CProject_ComputeFinalQuality. Derivation, constants and measured checks: docs/MOVIE_QUALITY.md.
//
// Pure functions: the inputs are already-gathered numbers (cast performance, script quality, ...), not game objects. Values the original stores as
// `float` go through Math.fround; the original also keeps x87 80-bit intermediates in places, so results can differ from the game in the last bits.

const f32 = Math.fround;

/** Tuning from Data\releasing_movies.ini [min_max] / [quality_overall] / [pre_production]. The defaults are the shipped values (docs/MOVIE_QUALITY.md). */
export interface QualityTuning {
  unspreadPerformanceMin: number; // unspread_performance_min
  unspreadPerformanceMax: number; // unspread_performance_max
  setRepairMin: number; // set_repair_value_min
  setRepairMax: number; // set_repair_value_max
  starGenreExperienceMin: number; // star_genre_experience_min
  starGenreExperienceMax: number; // star_genre_experience_max
  starRelationshipMin: number; // star_relationship_min
  starRelationshipMax: number; // star_relationship_max
  starRelationshipRangeWidth: number; // star_relationship_range_width
  crewMin: number; // crew_min
  crewMax: number; // crew_max
  overallShifterMidPoint: number; // quality_overall_shifter_mid_point
  overallMaxShifter: number; // quality_overall_max_shifter
  overallMaxAdder: number; // quality_overall_max_adder
  preProductionTime: number; // pre_production
}

export function defaultQualityTuning(): QualityTuning {
  return {
    unspreadPerformanceMin: f32(0.75),
    unspreadPerformanceMax: f32(1.5),
    setRepairMin: f32(0.9),
    setRepairMax: f32(1.0),
    starGenreExperienceMin: f32(0.8),
    starGenreExperienceMax: f32(1.2),
    starRelationshipMin: f32(0.8),
    starRelationshipMax: f32(1.2),
    starRelationshipRangeWidth: f32(0.5),
    crewMin: f32(0.9),
    crewMax: f32(1.1),
    overallShifterMidPoint: f32(0.4),
    overallMaxShifter: f32(0.1),
    overallMaxAdder: f32(0.8),
    preProductionTime: f32(300),
  };
}

const DEFAULT = defaultQualityTuning();

/** The five numbers a shot's rating is built from (CQualityRating +0xA4, +0xAC, +0xB0, +0xB4, +0xB8). */
export interface ProductionFactors {
  /** +0xA4, about 1.0 when everyone is average */
  castPerformance: number;
  /** +0xAC, 0..1, the base of the rating */
  scriptQuality: number;
  /** +0xB0, 0.8..1.2 */
  starRelationship: number;
  /** +0xB4, 0.9..1.0 */
  setCondition: number;
  /** +0xB8, 0.9..1.1 */
  crew: number;
}

export function productionFactors(p: Partial<ProductionFactors> = {}): ProductionFactors {
  return { castPerformance: 1, scriptQuality: 0, starRelationship: 1, setCondition: 1, crew: 1, ...p };
}

/** One shot that has a scene state: its weight (SceneState_GetShotWeight) and its rating. */
export interface ShotRating {
  weight: number;
  quality: number;
}

/** Everything CProject_ComputeFinalQuality reads from the project. */
export interface FinalQualityInput {
  /** project+0x348 is non-null */
  hasPreProduction: boolean;
  /** project+0x35C */
  ticksInPreProduction: number;
  /** the pre-production record's rating (+0x90) */
  preProductionQuality: number;
  /** only shots that have a controller and a scene state */
  shots: ShotRating[];
}

// Literals in the original code (not read from the ini).
const BONUS_CHUNK = f32(0.1); // the bonus is summed in chunks of this size ...
const BONUS_DECAY = f32(0.8); // ... each worth this much of the previous chunk
const PRE_PRODUCTION_SHARE = f32(0.25);
const SHOT_SHARE = f32(0.75);
const TICK_SECONDS = f32(0.1); // one project update is 0.1 s

/** The original clamps with `if (0 <= v) { if (v > 1) v = 1 } else v = 0`, so NaN ends up as 0. */
export function clamp01(v: number): number {
  if (v >= 0) return v <= 1 ? v : 1;
  return 0;
}

/** CQualityRating +0xA8: the cast performance mapped to 0..1 for the post-release breakdown screen. orig: 0x005D75F0 */
export function normalizePerformance(performance: number, t: QualityTuning = DEFAULT): number {
  return f32(clamp01(f32(f32(performance - t.unspreadPerformanceMin) / f32(t.unspreadPerformanceMax - t.unspreadPerformanceMin))));
}

/** CQualityRating +0xB4. repair is the set's repair value 0..1 (1.0 when the shot has no set). */
export function setConditionFactor(repair: number, t: QualityTuning = DEFAULT): number {
  return f32(f32(t.setRepairMax - t.setRepairMin) * repair + t.setRepairMin);
}

/**
 * CQualityRating +0xB8, the mapping part of CQualityRating_CrewFactor: meanMoviesTrait is the mean "Movies" trait of the crew. Collecting the crew
 * and the fallback for "no crew record" (FUN_005D8E10) are not ported. orig: 0x005D9130
 */
export function crewFactor(meanMoviesTrait: number, t: QualityTuning = DEFAULT): number {
  return f32(f32(t.crewMax - t.crewMin) * meanMoviesTrait + t.crewMin);
}

/**
 * The mapping part of CQualityRating_StarRelationshipFactor. chemistrySum is the sum of the per-star chemistry values (QualityCalc_StarChemistry) over
 * the lead cast stars plus the director if a star; counted is how many were summed.
 * quirk: with nobody counted the original skips the 0..1 mapping and returns the minimum (0.8), so a movie without stars gets the worst relationship
 * factor, not a neutral one. orig: 0x005D9520
 */
export function starRelationshipFactor(chemistrySum: number, counted: number, t: QualityTuning = DEFAULT): number {
  let v = f32(chemistrySum);
  if (counted !== 0) {
    const width = t.starRelationshipRangeWidth;
    v = f32(clamp01(f32(f32(f32(chemistrySum / counted) - f32(f32(1 - width) * 0.5)) / width)));
  }
  return f32(f32(t.starRelationshipMax - t.starRelationshipMin) * v + t.starRelationshipMin);
}

/**
 * QualityCalc_GenreExperienceFactor: genre is the actor's trait for the movie's primary genre, otherGenres the traits for every other genre. Other
 * genres add their mean, capped at half of the headroom (1 - genre). orig: 0x005D9390
 */
export function genreExperienceFactor(genre: number, otherGenres: readonly number[], t: QualityTuning = DEFAULT): number {
  let other = 0;
  if (otherGenres.length > 0) {
    let sum = 0;
    for (const v of otherGenres) sum = f32(sum + v);
    other = f32(sum / otherGenres.length);
    other = Math.min(other, f32(f32(1 - genre) * 0.5));
  }
  return f32(f32(other + genre) * f32(t.starGenreExperienceMax - t.starGenreExperienceMin) + t.starGenreExperienceMin);
}

/** CQualityRating_CastPerformance: the mean of the lead cast's performance with the director counted once. orig: 0x005DC900 */
export function averageCastPerformance(leadCastPerformance: readonly number[], directorPerformance: number): number {
  let sum = 0;
  for (const v of leadCastPerformance) sum = f32(sum + v);
  return f32(f32(directorPerformance + sum) / (leadCastPerformance.length + 1));
}

/**
 * Diminishing returns on the production bonus: linear below zero; above zero every further 0.1 is worth 20% less than the previous one (bounded by 0.4
 * with the default adder).
 */
export function diminishingBonus(x: number): number {
  if (!(x > 0)) return x; // penalties are linear and uncapped
  let bonus = 0;
  let weight = BONUS_DECAY;
  let left = f32(x);
  do {
    const chunk = left > BONUS_CHUNK ? BONUS_CHUNK : left;
    left = f32(left - BONUS_CHUNK);
    bonus = f32(bonus + f32(chunk * weight));
    weight = f32(weight * BONUS_DECAY);
  } while (left > 0);
  return bonus;
}

/**
 * The final formula of CQualityRating_Compute: the script quality is the base; production factors above 1.0 add a capped bonus, below 1.0 subtract
 * linearly. orig: 0x005DCB10
 */
export function computeQuality(f: ProductionFactors, t: QualityTuning = DEFAULT): number {
  const production = f32(f32(f32(f.setCondition * f.crew) * f.starRelationship) * f.castPerformance);
  const scriptOffset = f32(f.scriptQuality - t.overallShifterMidPoint);
  // Better scripts get a slightly smaller bonus: the shift is -2 * (S - midpoint) * maxShifter.
  const x = f32(f32(f32(production - 1) + f32(f32(f32(scriptOffset + scriptOffset) * -1) * t.overallMaxShifter)) * t.overallMaxAdder);
  return f32(clamp01(f32(diminishingBonus(x) + f.scriptQuality)));
}

/**
 * The share of the pre-production rating that counts after the movie spent this many updates in pre-production (0 at the start, 1 at
 * preProductionTime * 10 updates; ease-out cubic).
 */
export function preProductionWeight(ticksInPreProduction: number, t: QualityTuning = DEFAULT): number {
  // MOVIE_QUALITY.md section 7: the argument is clamped to 0..1. The clamp is not visible in the decompiled code (the value goes through the x87
  // stack into pow), so it is documented behaviour rather than read from the code.
  const x = f32(clamp01(f32(f32(f32(ticksInPreProduction) * TICK_SECONDS) / t.preProductionTime)));
  return f32(1 - f32(Math.pow(f32(1 - x), 3)));
}

/**
 * The movie's final quality, frozen when it enters post-production: 25% pre-production (weighted by time spent) plus 75% of the shot ratings averaged by
 * shot weight, clamped to 0..1. Award bonuses are added afterwards by other code.
 * Verified: reproduces the finalQuality the running game logged for two player movies (docs/MOVIE_QUALITY.md section 7), both exact to the logged 5
 * digits. Only in-range inputs were measured. orig: 0x005B6FB0 verified
 */
export function computeFinalQuality(input: FinalQualityInput, t: QualityTuning = DEFAULT): number {
  let quality = 0;
  if (input.hasPreProduction) {
    quality = f32(clamp01(f32(f32(PRE_PRODUCTION_SHARE * input.preProductionQuality) * preProductionWeight(input.ticksInPreProduction, t))));
  }
  let totalWeight = 0;
  for (const s of input.shots) totalWeight = (totalWeight + s.weight) | 0;
  let shotSum = 0;
  for (const s of input.shots) shotSum = f32(f32(f32(s.weight) / f32(totalWeight)) * s.quality + shotSum);
  return f32(clamp01(f32(f32(shotSum * SHOT_SHARE) + quality)));
}
