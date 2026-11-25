// A star's rating: how the components (movies, salary, performance, image, ...) combine, and how a film updates the two components that come from the
// star's film record.
//
// From CStar_ComputeStarRating (0x591720), CStar_AddMovieRating / AddPerformanceRating (0x585750 / 0x588070), CStar_ComputeEntourageComponent (0x587E40)
// and CStar_GetAwardsRatingComponent (0x590B00). Derivation: docs/STARS.md 3aa-3ac.
//
// The salary, relationships, image, trailer and press-bar components depend on game objects and are inputs here: the formulas inside them are not all
// decoded (see the doc). Nothing is verified against the running game.
import { clamp01 } from "../movie/MovieQuality.ts";
import { DecayValue } from "../movie/MovieSuccess.ts";

const f32 = Math.fround;

/** global.ini [star]. */
export interface StarRatingTuning {
  weightMovies: number; // starratingweightmovies
  weightSalary: number; // starratingweightsalary
  weightPerformance: number; // starratingweightperformance
  weightImage: number; // starratingweightimage
  weightEntourage: number; // starratingweightentourage
  weightTrailer: number; // starratingweighttrailer
  weightPressBar: number; // starratingweightpressbar
  weightRelationships: number; // starratingweightrelationships
  weightAwards: number; // starratingweightawards
  /** [star] ratingsmultiplier: the share of a film's success / performance that is added */
  ratingsMultiplier: number;
  /** [star] ratingshalflife, game years */
  ratingsHalfLife: number;
  /** the entourage component is members / 6 */
  entourageMembersForFull: number;
  /** the awards component is awards * 1/1.9 (two awards give the full value) */
  awardsPerAward: number;
}

export function defaultStarRatingTuning(): StarRatingTuning {
  return {
    weightMovies: f32(0.174), weightSalary: f32(0.139), weightPerformance: f32(0.139), weightImage: f32(0.104), weightEntourage: f32(0.104),
    weightTrailer: f32(0.104), weightPressBar: f32(0.102), weightRelationships: f32(0.07), weightAwards: f32(0.07),
    ratingsMultiplier: f32(0.4), ratingsHalfLife: f32(10), entourageMembersForFull: f32(6), awardsPerAward: f32(0.5263158),
  };
}

const DEFAULT = defaultStarRatingTuning();

/** The nine components, each 0..1 (clamped again here). */
export interface StarComponents {
  movies: number;
  salary: number;
  performance: number;
  image: number;
  entourage: number;
  trailer: number;
  pressBar: number;
  relationships: number;
  awards: number;
}

export function starComponents(p: Partial<StarComponents> = {}): StarComponents {
  return { movies: 0, salary: 0, performance: 0, image: 0, entourage: 0, trailer: 0, pressBar: 0, relationships: 0, awards: 0, ...p };
}

/**
 * CStar_ComputeStarRating: rating = clamp01(base + the sum of clamp01(weight * component)), accumulated in the game's order (salary, relationships, image,
 * trailer, entourage, awards, movies, performance, press bar) with a clamp to 0..1 after each step. base is the star's unweighted term (+0xCCC).
 * orig: 0x00591720
 */
export function computeStarRating(c: StarComponents, base = 0, t: StarRatingTuning = DEFAULT): number {
  let s = 0;
  const step = (w: number, v: number) => (s = clamp01(f32(f32(w * clamp01(v)) + s)));
  step(t.weightSalary, c.salary);
  step(t.weightRelationships, c.relationships);
  step(t.weightImage, c.image);
  step(t.weightTrailer, c.trailer);
  step(t.weightEntourage, c.entourage);
  step(t.weightAwards, c.awards);
  step(t.weightMovies, c.movies);
  step(t.weightPerformance, c.performance);
  step(t.weightPressBar, c.pressBar);
  return clamp01(f32(s + base));
}

/** CStar_ComputeEntourageComponent for the player's own stars: entourage members / 6, at most 1. orig: 0x00587E40 */
export function entourageComponent(members: number, t: StarRatingTuning = DEFAULT): number {
  return clamp01(f32(members / t.entourageMembersForFull));
}

/** CStar_GetAwardsRatingComponent: awards won * 0.526, at most 1. orig: 0x00590B00 */
export function awardsComponent(awardsWon: number, t: StarRatingTuning = DEFAULT): number {
  return clamp01(f32(awardsWon * t.awardsPerAward));
}

/**
 * CStar_AddMovieRating / CStar_AddPerformanceRating: a released film adds clamp01(ratingsMultiplier * value) to the star's decaying value, where value is
 * the film's success clamped to 0..1 (movies) or the star's mean shot performance (performance). nowYear is the game clock in years.
 * orig: 0x00585750  orig: 0x00588070
 */
export function addFilmRating(value: DecayValue, filmValue: number, nowYear: number, t: StarRatingTuning = DEFAULT): void {
  value.add(clamp01(f32(t.ratingsMultiplier * clamp01(filmValue))), nowYear);
}

/** A new decaying rating value with the configured half-life. */
export function newRatingValue(t: StarRatingTuning = DEFAULT): DecayValue {
  return new DecayValue(0, 0, t.ratingsHalfLife);
}

/** CStar_GetMoviesComponent / the performance component: the decayed value clamped to 0..1. orig: 0x005857E0 */
export function ratingComponent(value: DecayValue, nowYear: number): number {
  return f32(value.clamped01(nowYear));
}
