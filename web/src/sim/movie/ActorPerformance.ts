// How one actor's (or stunt performer's) contribution to a shot's quality is computed: the inputs averageCastPerformance and starRelationshipFactor
// (MovieQuality.ts) consume.
//
// From QualityCalc_ActorPerformance, CStar_GetMoodPerformanceFactor, the genre-fit and star chemistry helpers and the stunt performance factors.
// Derivation: docs/MOVIE_QUALITY.md section 3, docs/TRAITS_AND_EXPERIENCE.md section 3. Nothing here is verified: no measurement from the running game
// isolates these functions (the logs only cover the totals), so they follow the decompiled code. Where the code disagrees with the older notes, the
// comments say so.
import { clamp01, normalizePerformance, type QualityTuning, defaultQualityTuning } from "./MovieQuality.ts";

const f32 = Math.fround;
const THIRD = f32(0.33333334);

/** Tuning: releasing_movies.ini [min_max] (mood, genre fit) and stunts.ini [performance] / [likeness]. */
export interface ActorTuning {
  starMoodMin: number; // star_mood_min
  starMoodMax: number; // star_mood_max
  /** star_mood_step: the width of the outer mood bands */
  starMoodStep: number;
  genreFitMin: number; // stars' genre fit min
  genreFitMax: number; // stars' genre fit max
  /** [genre_fit] max_from_ideal: GenreFitScore's k is 1 / this */
  genreFitMaxFromIdeal: number;
  stuntSkillMin: number; // stuntskillminimum
  stuntSkillMax: number; // stuntskillmaximum
  healthMin: number; // healthminimum
  healthMax: number; // healthmaximum
  healthInjuryMultiplier: number; // injurymultiplier
  /** healththreshold: below this the performer counts as injured */
  healthThreshold: number;
  likenessMin: number; // likenessminimum
  likenessMax: number; // likenessmaximum
  /** likenessbonus: the star doubles for themselves */
  likenessBonus: number;
  /** successminimum: the take failed */
  successMin: number;
  /** successmaximum: the take succeeded */
  successMax: number;
  levelMin: number; // stuntlevelminimum
  levelMax: number; // stuntlevelmaximum
  releaseScreenMin: number; // releasescreenminbound
  releaseScreenMax: number; // releasescreenmaxbound
  /** likeness weights (they sum to 1) */
  genderFactor: number;
  sexFactor: number;
  weightFactor: number;
  ageFactor: number;
  looksFactor: number;
}

export function defaultActorTuning(): ActorTuning {
  return {
    starMoodMin: f32(0.8), starMoodMax: f32(1.2), starMoodStep: f32(0.25), genreFitMin: f32(0.9), genreFitMax: f32(1.1), genreFitMaxFromIdeal: f32(0.5),
    stuntSkillMin: f32(0.9), stuntSkillMax: f32(1.1), healthMin: f32(0.9), healthMax: f32(1.1), healthInjuryMultiplier: f32(0.9), healthThreshold: f32(0.01),
    likenessMin: f32(0.9), likenessMax: f32(1.0), likenessBonus: f32(1.1), successMin: f32(0.8), successMax: f32(1.25), levelMin: f32(0.9), levelMax: f32(1.4),
    releaseScreenMin: f32(0.6), releaseScreenMax: f32(2.0),
    genderFactor: f32(0.5), sexFactor: f32(0.1), weightFactor: f32(0.1), ageFactor: f32(0.15), looksFactor: f32(0.15),
  };
}

const DEFAULT = defaultActorTuning();
const DEFAULT_Q = defaultQualityTuning();

/** The record QualityCalc_ActorPerformance builds for one actor (0x90 bytes, kept for the release screen). */
export interface ActorPerformance {
  /** +0x7C, 0.8..1.2 */
  genreExperience: number;
  /** +0x80, 0.9..1.1 (the older notes called this the cast relationship factor; it is not) */
  genreFit: number;
  /** +0x8C, 0.8..1.2 */
  mood: number;
  /** +0x88, the product mapped to 0..1 for display */
  normalized: number;
  /** +0x84, -1 for extras */
  starRating: number;
  /** what the quality rating averages: genreExperience * genreFit * mood */
  performance: number;
}

/** QualityCalc_ActorPerformance, once the three factors are known. Extras use starMoodMin as their mood and have no rating. orig: 0x005DB140 */
export function computeActorPerformance(genreExperience: number, genreFit: number, mood: number, starRating: number, q: QualityTuning = DEFAULT_Q): ActorPerformance {
  const performance = f32(f32(genreExperience * genreFit) * mood);
  return { genreExperience, genreFit, mood, starRating, performance, normalized: f32(clamp01(normalizePerformance(performance, q))) };
}

/**
 * CStar_GetMoodPerformanceFactor: the star's mood (0..1) mapped onto 0.8..1.2 in three bands. Below the lower mood threshold the first band (width
 * (1 - 2 * step) / 3), between the thresholds a middle band centred on 0.5, above the upper threshold a top band reaching 1.0; each band is linear and
 * the bands do not join up (the curve has steps). The older notes said the middle was flat; the code interpolates it (0.97 .. 1.03 with the shipped
 * step 0.25). Any value outside 0..1 gives starMoodMin. orig: 0x005D79A0
 */
export function moodPerformanceFactor(mood: number, lowerThreshold: number, upperThreshold: number, t: ActorTuning = DEFAULT): number {
  const outerBand = f32(f32(1 - f32(t.starMoodStep + t.starMoodStep)) * THIRD);
  if (lowerThreshold < 0 || lowerThreshold > 1 || upperThreshold < 0 || upperThreshold > 1 || mood < 0 || mood > 1) return t.starMoodMin;
  let f: number; // double in the original
  if (lowerThreshold > 0 && mood < lowerThreshold) {
    f = (mood / lowerThreshold) * outerBand; // unhappy: first band
  } else if (upperThreshold <= 0 || upperThreshold <= mood) {
    if (upperThreshold === 1) f = mood;
    else {
      const top = 1 - outerBand; // happy: top band reaching 1.0
      f = (1 - top) * ((mood - upperThreshold) / (1 - upperThreshold)) + top;
    }
  } else {
    let along = 0; // between the thresholds: a narrow band around 0.5
    if (upperThreshold !== lowerThreshold && lowerThreshold !== 0) along = (mood - lowerThreshold) / (upperThreshold - lowerThreshold);
    const start = t.starMoodStep + outerBand;
    f = start + (1 - start - start) * along;
  }
  return f32((t.starMoodMax - t.starMoodMin) * f + t.starMoodMin);
}

/**
 * The genre-fit score of a character against the movie's genre: the mean of three terms 1 - |difference| * k, where k is 1 / max_from_ideal
 * ([genre_fit]) and the differences are how far the character's age / looks / body are from the genre's ideal. Perfect Fit (award bonus 7) multiplies
 * the result; pass < 0 for "not active". Gathering the three differences from a character is not ported, so k is a parameter.
 * orig: 0x005882E0  orig: 0x0056F940
 */
export function genreFitScore(diff1: number, diff2: number, diff3: number, k: number, perfectFitMultiplier = -1): number {
  const term = (d: number) => f32(1 - f32(Math.abs(d) * k));
  let fit = f32(f32(f32(term(diff1) + term(diff2)) + term(diff3)) * THIRD);
  if (perfectFitMultiplier >= 0) fit = f32(perfectFitMultiplier * fit);
  return clamp01(fit);
}

/**
 * FUN_005D7B90 / FUN_005D7CB0: an actor's genre-fit factor, 0.9..1.1. The director always gets 1.0; a character who is neither star nor extra gets the
 * minimum. (The older notes called this the actor's relationship with the cast.) orig: 0x005D7B90  orig: 0x005D7CB0
 */
export function genreFitFactor(fitScore: number, isDirector: boolean, isStarOrExtra = true, t: ActorTuning = DEFAULT): number {
  if (isDirector) return 1;
  const score = isStarOrExtra ? fitScore : 0;
  let scaled = f32(f32(t.genreFitMax - t.genreFitMin) * score);
  if (scaled < 0) return t.genreFitMin;
  if (scaled > 1) scaled = 1;
  return f32(scaled + t.genreFitMin);
}

/**
 * QualityCalc_StarChemistry: the mean of the stored relationship values between this star and the other lead stars; the director (if a star, and not
 * excluded) counts double. 0.5 when there is nobody to compare with. Pass null for no director. orig: 0x005D87A0  orig: 0x005D8C80
 */
export function starChemistry(otherStarRelationships: readonly number[], directorRelationship: number | null): number {
  let sum = 0;
  let count = 0;
  for (const r of otherStarRelationships) {
    sum = f32(sum + r);
    count++;
  }
  if (directorRelationship !== null) {
    sum = f32(f32(directorRelationship + directorRelationship) + sum);
    count += 2;
  }
  if (count === 0) return f32(0.5);
  return f32(sum / count);
}

/** CQualityRating_CrewFactor's input (FUN_005D8E10): the mean of the crew's "Movies" trait, 0 when there is no crew. orig: 0x005D8E10 */
export function meanMoviesTrait(crewMoviesTrait: readonly number[]): number {
  if (crewMoviesTrait.length === 0) return 0;
  let sum = 0;
  for (const v of crewMoviesTrait) sum = f32(sum + v);
  return f32(sum / crewMoviesTrait.length);
}

// ---- Stunt performance (a stunt shot's actor score; docs/TRAITS_AND_EXPERIENCE.md section 3) ----

/** What QualityCalc_ComputeLikeness compares between the stunt double and the star (current costume values). */
export interface LikenessTraits {
  female: boolean;
  age: number;
  weight: number;
  looks: number;
  sexAppeal: number;
}

/** orig: 0x00597820 */
export function likeness(a: LikenessTraits, b: LikenessTraits, t: ActorTuning = DEFAULT): number {
  const genderDiff = a.female !== b.female ? 1 : 0;
  const ageTerm = clamp01(f32(Math.abs(f32(a.age - b.age)) * f32(0.02))); // 50 years apart = 1
  const weightTerm = clamp01(f32(Math.abs(f32(a.weight - b.weight)) * f32(0.01))); // 100 units apart = 1
  const looksTerm = Math.abs(f32(a.looks - b.looks));
  const sexTerm = Math.abs(f32(a.sexAppeal - b.sexAppeal));
  const sum = f32(f32(f32(f32(f32(t.genderFactor * genderDiff) + f32(t.ageFactor * ageTerm)) + f32(t.weightFactor * weightTerm)) + f32(looksTerm * t.looksFactor)) + f32(sexTerm * t.sexFactor));
  return clamp01(f32(1 - sum));
}

/** 0.9 + 0.1 * likeness; 1.1 when the star does the stunt themselves (or there is no double and no star). orig: 0x005D78A0 */
export function likenessFactor(likenessValue: number, sameActor: boolean, t: ActorTuning = DEFAULT): number {
  if (sameActor) return t.likenessBonus;
  const scaled = f32(f32(t.likenessMax - t.likenessMin) * likenessValue);
  if (scaled < 0) return t.likenessMin;
  return f32((scaled > 1 ? 1 : scaled) + t.likenessMin);
}

/** 0.9 + 0.2 * health, times the injury multiplier below the health threshold; a missing performer gets the minimum. orig: 0x005D7920 */
export function healthFactor(health: number, noPerformer: boolean, t: ActorTuning = DEFAULT): number {
  if (noPerformer) return t.healthMin;
  const f = f32(f32(f32(t.healthMax - t.healthMin) * health) + t.healthMin);
  return health < t.healthThreshold ? f32(f * t.healthInjuryMultiplier) : f;
}

/** 0.9 + 0.2 * the "Stunts" trait; a missing performer gets the minimum. orig: 0x005D8920 */
export function stuntSkillFactor(stuntsTrait: number, noPerformer: boolean, t: ActorTuning = DEFAULT): number {
  if (noPerformer) return t.stuntSkillMin;
  return f32(f32(f32(t.stuntSkillMax - t.stuntSkillMin) * stuntsTrait) + t.stuntSkillMin);
}

/** The take's success factor: 1.25 if it succeeded, 0.8 if it failed. */
export function stuntSuccessFactor(succeeded: boolean, t: ActorTuning = DEFAULT): number {
  return succeeded ? t.successMax : t.successMin;
}

/**
 * The level factor from the scene's stunt difficulty (0..1): 0.9 + clamp01((1.4 - 0.9) * difficulty), as documented in TRAITS_AND_EXPERIENCE.md. The
 * decompiled QualityCalc_StuntPerformance shows only a clamp01 of the difficulty and a multiplication; the mapping to 0.9..1.4 is not visible there
 * (x87 code), so the documented formula is used. Not verified against the running game.
 */
export function stuntLevelFactor(difficulty: number, t: ActorTuning = DEFAULT): number {
  return f32(t.levelMin + clamp01(f32(f32(t.levelMax - t.levelMin) * difficulty)));
}

/**
 * QualityCalc_StuntPerformance: skill * (health * likeness) * level * success, the level from the scene's stunt difficulty. A perfect shot scores about
 * 2.3, a poor failed one about 0.5. orig: 0x005D8BD0
 */
export function stuntPerformance(skill: number, health: number, likenessF: number, difficulty: number, succeeded: boolean, t: ActorTuning = DEFAULT): number {
  return f32(f32(f32(skill * f32(health * likenessF)) * stuntLevelFactor(clamp01(difficulty), t)) * stuntSuccessFactor(succeeded, t));
}

/** ReleaseScreen_NormalizeScore: a stunt score clamped to 0.6..2.0 and mapped to 0..1. orig: 0x006F9CF0 */
export function normalizeStuntScore(score: number, t: ActorTuning = DEFAULT): number {
  if (score <= t.releaseScreenMin) score = t.releaseScreenMin;
  if (t.releaseScreenMax <= score) score = t.releaseScreenMax;
  return clamp01(f32(f32(score - t.releaseScreenMin) / f32(t.releaseScreenMax - t.releaseScreenMin)));
}
