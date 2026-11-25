// MovieSuccess against the values the running game logged (docs/MOVIE_SUCCESS.md 3j, 3u, 3v; AWARDS.md 3k) and against hand-computed examples
// for the formulas the logs do not isolate.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boredomFactor, cappedHype, castStarRatingsFactor, computeSuccess, createAIIncome, createPlayerIncome, dailyPayout, DecayValue, genrePopularity,
  genreTrend, marketingPublicInterest, movieStarRating, publicInterestCoverage, publicInterestFactor, publicInterestFactorAI, saturationPushAmount,
  successFactors, techPioneeringFactor,
} from "../../src/sim/movie/MovieSuccess.ts";
import { f32, nearD as near } from "./check.ts";

test("the first AI release (1920, romance): logged PI 1.1200, SR 0.9408, S 0.28120", () => {
  const q = f32(0.20098), h = f32(0.2232);
  near("AI public interest (hype > quality)", publicInterestFactorAI(h, q), 1.12, 1e-4);
  near("AI success (positive bonus branch)", computeSuccess(q, successFactors({ starRatings: f32(0.9408), publicInterest: f32(1.12) })), 0.2812, 1e-4);
  const inc = createAIIncome(f32(0.2812), h, false);
  near("AI pool", inc.initialPool, 180701.91, 5);
  near("AI adder maximum", inc.adderMaximum, 90.35, 0.05);
  near("AI daily percentage", inc.dailyPercentage, 0.006941, 1e-6);
  near("AI daily multiplier", inc.dailyMultiplier, 0.997864, 1e-6);
  near("AI PI, hype > quality", publicInterestFactorAI(f32(0.3492), f32(0.18888)), 1.1195, 1e-4);
  near("AI PI, hype < quality", publicInterestFactorAI(f32(0.2397), f32(0.25548)), 1.1126, 1e-4);
});

test("player movie 1 (1922): logged S 0.20992, pool 131,692.80", () => {
  const s = computeSuccess(f32(0.17509), successFactors({ starRatings: f32(0.9299), genrePopularity: f32(1.05) }));
  near("player movie 1 success", s, 0.20992, 1e-4);
  near("player movie 1 star rating", movieStarRating(f32(0.20992), f32(0.17509), false), 0.211, 1e-4);
  const inc = createPlayerIncome(f32(0.20992), 0, 0);
  near("player movie 1 pool", inc.initialPool, 131692.8, 2);
  near("player movie 1 daily percentage", inc.dailyPercentage, 0.0052, 1e-7);
  near("player movie 1 daily multiplier", inc.dailyMultiplier, 0.9984, 1e-7);
});

test("player movie 2 (negative branch): sets at boredom 1.0 x3, two cast members; logged BO 0.8695, S 0.13427", () => {
  // The logged cast boredom mean 0.1309 is one cast member used 0.7856 years earlier (boost 0.3, half-life 4 years) and one new one.
  const star = new DecayValue(0, 0.3, 4);
  near("star boredom decays with a 4-year half-life", star.current(0.7856) / 2, 0.1309, 1e-4);
  const b = boredomFactor([1, 1, 1], [f32(star.current(0.7856)), 0]);
  near("mean boredom", b.meanBoredom, 0.6524, 1e-4);
  near("boredom factor", b.factor, 0.8695, 1e-4);
  const f = successFactors({ starRatings: f32(0.9607), genrePopularity: f32(1.05), boredom: f32(0.8695) });
  near("player movie 2 success (negative branch)", computeSuccess(f32(0.16907), f), 0.13427, 1e-4);
  near("player movie 2 star rating", movieStarRating(f32(0.13427), f32(0.16907), false), 0.1538, 1e-4);
  near("player movie 2 pool", createPlayerIncome(f32(0.13427), 0, 0).initialPool, 95240.56, 3);
});

test("genre trend and popularity", () => {
  const action = [{ year: 1924.5, value: 1 }];
  near("trend at the event", genreTrend(action, 1924.5), 1, 1e-6);
  near("trend 0.357 years after a popular event", genreTrend(action, 1924.857), 0.97, 1e-4);
  near("trend before any event", genreTrend(action, 1920), 0.5, 0);
  near("trend after an unpopular event", genreTrend([{ year: 1927.7, value: 0 }], 1927.7 + 4), 0.25, 1e-6);
  near("only the latest event counts", genreTrend([{ year: 1927.7, value: 0 }, { year: 1929.8, value: 1 }], 1929.8), 1, 1e-6);
  near("popularity, neutral trend, no saturation", genrePopularity(0.5, 0), 1.05, 1e-6);
  near("player movie 4 (action 1924.82)", genrePopularity(f32(0.97303), 0), 1.1919, 1e-4);
  // Trendsetter active: the trend is forced to 1.0, only saturation differs.
  near("trendsetter, horror", genrePopularity(f32(0.1), f32(0.1697), 1), 1.1593, 1e-4);
  near("trendsetter, romance", genrePopularity(f32(0.1), f32(0.2478), 1), 1.1405, 1e-4);
  near("fully saturated genre", genrePopularity(0.5, 1), 1.05 * 0.8, 1e-6);
});

test("marketing and public interest with PR (1945-48 releases): logged D and PI", () => {
  near("D, level 3", marketingPublicInterest(f32(0.3082), f32(0.62), 3, false), 0.3459, 1e-4);
  near("D, level 4", marketingPublicInterest(f32(0.2989), f32(0.5978), 4, false), 0.5258, 1e-4);
  near("D, level 5", marketingPublicInterest(f32(0.3104), f32(0.6208), 5, false), 0.6896, 1e-4);
  near("D, level 1 gives nothing", marketingPublicInterest(f32(0.3), f32(0.6), 1, false), 0, 0);
  near("D, no marketing", marketingPublicInterest(f32(0.3), f32(0.6), 0, false), 0, 0);
  near("PI release 1", publicInterestFactor(publicInterestCoverage(f32(0.3104), f32(0.6896), f32(0.6208))), 1.3352, 1e-4);
  near("PI release 2", publicInterestFactor(publicInterestCoverage(f32(0.2989), f32(0.5258), f32(0.5978))), 1.3627, 1e-4);
  near("PI without PR", publicInterestFactor(publicInterestCoverage(0, 0, f32(0.6))), 1, 1e-6);
  near("capped hype", cappedHype(f32(0.74), f32(0.6)), 0.3, 1e-6);
  near("hype below the cap", cappedHype(f32(0.1), f32(0.6)), 0.1, 1e-6);
  // Qm 0.6, hype 0.3 and D 0.3: publicity exactly covers the quality, no imbalance: the best case.
  near("PI best case", publicInterestFactor(publicInterestCoverage(f32(0.3), f32(0.3), f32(0.6))), 1.4, 1e-5);
});

test("cast star ratings (hand-computed from the formula)", () => {
  near("no stars", castStarRatingsFactor([], f32(0.6)), 0.8, 1e-6);
  // one star rated 0.6: sum = 0.7 * 0.6 = 0.42; x = 0.42 / (3 * 0.6 - 0.3) = 0.28; SR = 0.8 + 0.4 * 0.28 = 0.912
  near("one star", castStarRatingsFactor([f32(0.6)], f32(0.6)), 0.912, 1e-5);
  // weights 0.7, 0.49, 0.2401: ratings given in any order are sorted best first
  const expectedSum = 0.7 * 0.9 + 0.49 * 0.5 + 0.2401 * 0.2;
  near("three stars, unsorted", castStarRatingsFactor([f32(0.2), f32(0.9), f32(0.5)], f32(0.6)), 0.8 + 0.4 * (expectedSum / 1.5), 1e-5);
  near("quality floor of 0.2 for the divisor", castStarRatingsFactor([0.5], 0), 1.2, 1e-6);
  near("big stars saturate", castStarRatingsFactor([1, 1, 1], f32(0.3)), 1.2, 1e-6);
});

test("success edge cases", () => {
  const neutral = successFactors();
  near("neutral market", computeSuccess(0.5, neutral), 0.5, 1e-6); // P = 1 and Qm at the mid point: no change
  const s = computeSuccess(1, successFactors({ techPioneering: f32(1.1), starRatings: f32(1.2), genrePopularity: f32(1.2), publicInterest: f32(1.4) }));
  assert.ok(s > 1 && s <= f32(1.4), `success above 1: got ${s}`); // not capped at 1, but the bonus is bounded by 0.4
  near("success never negative", computeSuccess(0, successFactors({ boredom: f32(0.8), genrePopularity: f32(0.72), starRatings: f32(0.8) })), 0, 0);
  near("out-of-range quality counts as 1.0", computeSuccess(1.5, neutral), computeSuccess(1, neutral), 0);
  near("no boredom ingredients", boredomFactor([], []).factor, 0, 0);
  near("fresh ingredients", boredomFactor([0], [0]).factor, 1, 1e-6);
  near("tech pioneer", techPioneeringFactor(true), 1.1, 1e-6);
  near("no tech pioneer", techPioneeringFactor(false), 1, 0);
  near("rating cuts success at 1", movieStarRating(2, 0.5, false), 0.73 + 0.33 * 0.5, 1e-6);
  near("rating of a perfect movie", movieStarRating(1, f32(0.9), false), 1, 0);
});

test("revenue payout", () => {
  const inc = createAIIncome(0.5, 0, false);
  near("pool at S = 0.5", inc.initialPool, 420000, 1e-3);
  near("pool at S = 1.4", createAIIncome(f32(1.4), 0, false).initialPool, 2814000, 1);
  near("back catalogue has no pool", createAIIncome(0.5, f32(0.3), true).pool, 0, 0);
  const rate0 = inc.dailyPercentage;
  const paid = dailyPayout(inc, 0);
  near("first payout without the random extra", paid, 420000 * rate0, 1e-6);
  near("rate decays", inc.dailyPercentage, rate0 * inc.dailyMultiplier, 1e-12);
  // Pay out for years: everything is paid, never more than the pool.
  let total = paid;
  for (let day = 0; day < 5000; day++) total += dailyPayout(inc, 0.5);
  near("whole pool is paid out", total, 420000, 1e-6);
  near("pool is empty", inc.pool, 0, 0);
  near("no payout from an empty pool", dailyPayout(inc, 1), 0, 0);
  // The first-year share for an AI movie: about 87% of the pool is paid within the first year (MOVIE_SUCCESS.md 3j).
  const ai = createAIIncome(f32(0.2812), f32(0.2232), false);
  let year = 0;
  for (let day = 0; day < 360; day++) year += dailyPayout(ai, 0.5);
  near("share paid in the first year", year / ai.initialPool, 0.87, 0.02);
});

test("genre saturation", () => {
  near("nothing is recorded before 1930", saturationPushAmount(1929), 0, 0);
  near("nothing at 1930.0", saturationPushAmount(1930), 0, 0);
  near("ramp at 1935", saturationPushAmount(1935), 0.15 * 0.5, 1e-6);
  near("full size from 1940", saturationPushAmount(1945), 0.15, 1e-6);
  near("award weight", saturationPushAmount(1945, 0.5), 0.075, 1e-6);
  const sat = new DecayValue(1945, 0, 2);
  sat.add(0.15, 1945);
  near("saturation after one release", sat.clamped01(1945), 0.15, 1e-9);
  near("halves in two years", sat.clamped01(1947), 0.075, 1e-9);
  sat.add(0.15, 1947);
  near("a second release adds to the decayed value", sat.clamped01(1947), 0.225, 1e-9);
  near("never above 1", new DecayValue(0, 5, 2).clamped01(0), 1, 0);
});
