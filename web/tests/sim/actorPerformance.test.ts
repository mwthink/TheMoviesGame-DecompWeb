// ActorPerformance against the worked examples in docs/TRAITS_AND_EXPERIENCE.md (stunts, likeness) and hand-computed values for the formulas the
// notes give no numbers for (mood bands, chemistry, genre fit).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeActorPerformance, genreFitFactor, genreFitScore, healthFactor, likeness, likenessFactor, meanMoviesTrait, moodPerformanceFactor,
  normalizeStuntScore, starChemistry, stuntLevelFactor, stuntPerformance, stuntSkillFactor, stuntSuccessFactor, type LikenessTraits,
} from "../../src/sim/movie/ActorPerformance.ts";
import { averageCastPerformance, computeQuality, crewFactor, productionFactors, setConditionFactor, starRelationshipFactor } from "../../src/sim/movie/MovieQuality.ts";
import { f32, nearD as near } from "./check.ts";

test("likeness (TRAITS_AND_EXPERIENCE.md 3b)", () => {
  const star: LikenessTraits = { female: false, age: 30, weight: 70, looks: 0.5, sexAppeal: 0.5 };
  near("identical characters", likeness(star, star), 1, 1e-6);
  const female = { ...star, female: true };
  near("gender mismatch alone costs 0.5", likeness(star, female), 0.5, 1e-6);
  near("... factor 0.95", likenessFactor(likeness(star, female), false), 0.95, 1e-6);
  const older = { ...star, age: 60 };
  near("30 year age gap: 0.15 * 0.6", likeness(star, older), 1 - 0.09, 1e-6);
  near("... factor 0.991", likenessFactor(likeness(star, older), false), 0.991, 1e-6);
  near("40 unit weight gap: factor 0.996", likenessFactor(likeness(star, { ...star, weight: 110 }), false), 0.996, 1e-6);
  const worst: LikenessTraits = { female: true, age: 100, weight: 200, looks: 1, sexAppeal: 1 };
  const best: LikenessTraits = { female: false, age: 0, weight: 0, looks: 0, sexAppeal: 0 };
  near("total mismatch", likeness(best, worst), 0, 1e-6);
  near("... reaches the 0.9 floor", likenessFactor(0, false), 0.9, 1e-6);
  near("the star doubling for themselves", likenessFactor(1, true), 1.1, 1e-6);
  near("a good double", likenessFactor(1, false), 1, 1e-6);
});

test("stunt performance", () => {
  near("skill factor, no skill", stuntSkillFactor(0, false), 0.9, 1e-6);
  near("skill factor, expert", stuntSkillFactor(1, false), 1.1, 1e-6);
  near("skill factor, nobody", stuntSkillFactor(1, true), 0.9, 1e-6);
  near("health factor, healthy", healthFactor(1, false), 1.1, 1e-6);
  near("health factor, half", healthFactor(0.5, false), 1, 1e-6);
  near("health factor, injured", healthFactor(f32(0.005), false), (0.9 + 0.2 * 0.005) * 0.9, 1e-6);
  near("health factor, nobody", healthFactor(1, true), 0.9, 1e-6);
  near("success factor", stuntSuccessFactor(true), 1.25, 1e-6);
  near("failure factor", stuntSuccessFactor(false), 0.8, 1e-6);
  near("level factor, easy", stuntLevelFactor(0), 0.9, 1e-6);
  near("level factor, hardest", stuntLevelFactor(1), 1.4, 1e-6);
  // "a perfect-looking stunt shot (1.1 x 1.1 x 1.1 x 1.4 x 1.25, about 2.3)"
  near("perfect stunt shot", stuntPerformance(f32(1.1), f32(1.1), f32(1.1), 1, true), 1.1 * 1.1 * 1.1 * 1.4 * 1.25, 1e-5);
  near("poor failed stunt shot", stuntPerformance(f32(0.9), f32(0.9), f32(0.9), 0, false), 0.9 * 0.9 * 0.9 * 0.9 * 0.8, 1e-5);
  near("normalise: bottom", normalizeStuntScore(f32(0.47)), 0, 0);
  near("normalise: top", normalizeStuntScore(f32(2.3)), 1, 0);
  near("normalise: middle", normalizeStuntScore(f32(1.3)), 0.5, 1e-6);
});

test("mood bands (shipped step 0.25: outer band width 1/6; middle band 0.41667..0.58333)", () => {
  const lo = f32(0.15), hi = f32(0.75); // thresholds as capped by Easy To Please
  near("mood 0 (worst)", moodPerformanceFactor(0, lo, hi), 0.8, 1e-6);
  near("mood just below the lower threshold", moodPerformanceFactor(f32(0.1499), lo, hi), 0.8 + 0.4 * (1 / 6), 1e-3);
  near("mood at the lower threshold", moodPerformanceFactor(lo, lo, hi), 0.8 + 0.4 * (0.25 + 1 / 6), 1e-6);
  near("mood in the middle", moodPerformanceFactor(f32(0.45), lo, hi), 0.8 + 0.4 * (5 / 12 + (1 / 6) * 0.5), 1e-6);
  near("mood at the upper threshold", moodPerformanceFactor(hi, lo, hi), 0.8 + 0.4 * (5 / 6), 1e-6);
  near("mood 1 (best)", moodPerformanceFactor(1, lo, hi), 1.2, 1e-6);
  near("mood out of range", moodPerformanceFactor(1.5, lo, hi), 0.8, 1e-6);
  near("threshold out of range", moodPerformanceFactor(0.5, f32(-0.1), hi), 0.8, 1e-6);
  near("upper threshold 1", moodPerformanceFactor(1, f32(0.3), 1), 1.2, 1e-6);
  // Steps: happier is never worse inside a band, and each band starts above where the previous one ended.
  let prev = 0;
  for (let i = 0; i <= 100; i++) {
    const m = f32(i / 100);
    const f = moodPerformanceFactor(m, 0.25, 0.75);
    assert.ok(f >= f32(0.8 - 1e-6) && f <= f32(1.2 + 1e-6), `mood factor out of 0.8..1.2 at ${m}: ${f}`);
    assert.ok(f + 1e-6 >= prev, `mood factor decreases at ${m}: ${f} < ${prev}`);
    prev = f;
  }
});

test("genre fit and the actor record", () => {
  near("fit score, perfect", genreFitScore(0, 0, 0, 2), 1, 1e-6);
  near("fit score, halfway", genreFitScore(0.25, 0.25, 0.25, 2), 0.5, 1e-6);
  near("fit score, mixed", genreFitScore(0, 0.5, 1, 1), (1 + 0.5 + 0) / 3, 1e-6);
  near("fit score, far off", genreFitScore(2, 2, 2, 1), 0, 0);
  near("fit score, perfect fit bonus clamps", genreFitScore(0, 0, 0, 1, f32(1.2)), 1, 0);
  near("fit score, perfect fit bonus", genreFitScore(0.25, 0.25, 0.25, 2, f32(1.2)), 0.6, 1e-6);
  near("fit factor, best", genreFitFactor(1, false), 1.1, 1e-6);
  near("fit factor, worst", genreFitFactor(0, false), 0.9, 1e-6);
  near("fit factor, director is neutral", genreFitFactor(0, true), 1, 0);
  near("fit factor, neither star nor extra", genreFitFactor(1, false, false), 0.9, 1e-6);

  let p = computeActorPerformance(f32(1.2), f32(1.1), f32(1.2), f32(0.7));
  near("performance is the product", p.performance, 1.2 * 1.1 * 1.2, 1e-5);
  const n = (1.2 * 1.1 * 1.2 - 0.75) / 0.75;
  near("normalised performance", p.normalized, n > 1 ? 1 : n, 1e-5);
  p = computeActorPerformance(f32(0.8), f32(0.9), f32(0.8), -1);
  near("weak extra", p.performance, 0.8 * 0.9 * 0.8, 1e-6);
  near("weak extra normalises to 0", p.normalized, 0, 0);
  near("average actor", computeActorPerformance(1, 1, 1, 0.5).normalized, (1 - 0.75) / 0.75, 1e-6);
});

test("chemistry and crew", () => {
  near("nobody to compare with", starChemistry([], null), 0.5, 0);
  near("one friend", starChemistry([f32(0.8)], null), 0.8, 1e-6);
  near("two stars averaged", starChemistry([f32(0.8), f32(0.4)], null), 0.6, 1e-6);
  near("director counts double", starChemistry([f32(0.8)], f32(0.2)), (0.8 + 2 * 0.2) / 3, 1e-6);
  near("director alone", starChemistry([], f32(0.2)), 0.2, 1e-6);
  near("crew mean", meanMoviesTrait([f32(0.1), f32(0.3)]), 0.2, 1e-6);
  near("no crew", meanMoviesTrait([]), 0, 0);
});

test("the quality chain end to end: a shot built from these pieces", () => {
  const lead = computeActorPerformance(1, f32(1.05), 1, f32(0.6));
  const director = computeActorPerformance(1, 1, 1, f32(0.4));
  const cast = averageCastPerformance([lead.performance], director.performance);
  near("cast performance of lead + director", cast, (1.05 + 1) / 2, 1e-6);
  const f = productionFactors({
    castPerformance: cast, scriptQuality: f32(0.6), starRelationship: starRelationshipFactor(starChemistry([], null), 1),
    setCondition: setConditionFactor(1), crew: crewFactor(meanMoviesTrait([0.5, 0.5])),
  });
  near("neutral chemistry gives 1.0", f.starRelationship, 1, 1e-6);
  const q = computeQuality(f);
  assert.ok(q > f32(0.568) && q < 1, `end-to-end shot quality ${q}`); // above the all-neutral 0.568: cast and crew are slightly better than average
});
