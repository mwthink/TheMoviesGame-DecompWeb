// The whole-movie estimate: the quality chain, the marketing table of docs/MOVIE_SUCCESS.md 3w and two logged PR releases.
import assert from "node:assert/strict";
import { test } from "node:test";
import { compareMarketingLevels, estimateInput, estimateMovie } from "../../src/sim/movie/MovieEstimate.ts";
import { nearD as near } from "./check.ts";

test("the quality chain: everything neutral, script 0.6", () => {
  const r = estimateMovie(estimateInput({ marketingLevel: 1 }));
  near("shot quality (MOVIE_QUALITY.md section 2: all factors 1.0, 3-star script)", r.shotQuality, 0.568, 0.0005);
  near("final quality (full pre-production weight, identical shots)", r.finalQuality, 0.568, 0.0005);
  near("no PR, no marketing", r.factors.publicInterest, 1, 1e-6);
  near("capped hype", r.cappedHype, 0, 0);
  near("marketing cost", r.marketingCost, 0, 0);
  assert.ok(r.boxOffice > 70000);
  near("net", r.netBoxOffice, r.boxOffice, 0);
  near("the pool follows the revenue formula", r.boxOffice, 1400000 * r.success * r.success + 70000, 1);
  // about 81% of the pool in the first year with no public interest (MOVIE_SUCCESS.md measured about 87% for an AI movie with hype)
  assert.ok(r.firstYearShare > 0.75 && r.firstYearShare < 0.87, `${r.firstYearShare}`);
});

test("pre-production, ingredients and marketing", () => {
  const input = estimateInput({ preProductionTicks: 0 });
  const r = estimateMovie(input);
  near("no pre-production: at most 75% of the shot quality (MOVIE_QUALITY.md section 7)", r.finalQuality, 0.75 * r.shotQuality, 1e-5);
  assert.ok(estimateMovie({ ...input, castPerformance: 1.2, crewMoviesTrait: 1, chemistry: 0.9 }).shotQuality > r.shotQuality, "better ingredients");
  assert.ok(estimateMovie({ ...input, hasStars: false }).shotQuality < r.shotQuality, "no stars: the worst relationship factor");
  near("marketing changes only the market side", estimateMovie({ ...input, marketingLevel: 3, hype: 0.2 }).finalQuality, r.finalQuality, 0);
});

test("the marketing table of MOVIE_SUCCESS.md 3w", () => {
  // "typical film (TP 1.1, SR 0.94, GP 1.07, BO 0.93)"; gain = pool increase minus cost, relative to level 1, in thousands of dollars (levels 2..5)
  const rows: [number, number, number[]][] = [
    [0.62, 0.31, [100, 148, 77, -3]], [0.62, 0.2, [134, 169, 109, 32]], [0.62, 0.1, [113, 166, 137, 67]],
    [0.75, 0.375, [90, 162, 145, 70]], [0.75, 0.15, [130, 182, 201, 136]], [0.5, 0.25, [114, 91, 19, -67]],
  ];
  for (const [qm, hc, gains] of rows) {
    const levels = compareMarketingLevels(estimateInput({
      qualityOverride: qm, hype: hc, techPioneer: true,
      genreTrend: (Math.fround(1.07) - Math.fround(0.9)) / Math.fround(0.3), // GP 1.07 with no saturation
      setBoredom: [0.35], // BO 0.93: (1 - 0.35) * 0.2 + 0.8
      starRatings: [(0.35 * (3 * Math.fround(qm) - 0.3)) / 0.7], // one star rated so that SR = 0.94
      symmetricImbalance: true, // the table was computed with the symmetric reading
    }));
    near("SR", levels[0]!.factors.starRatings, 0.94, 1e-4);
    near("GP", levels[0]!.factors.genrePopularity, 1.07, 1e-4);
    near("BO", levels[0]!.factors.boredom, 0.93, 1e-4);
    for (let lvl = 2; lvl <= 5; lvl++) {
      const gain = (levels[lvl - 1]!.boxOffice - levels[0]!.boxOffice - levels[lvl - 1]!.marketingCost) / 1000;
      near(`Qm ${qm} hype ${hc} level ${lvl}`, gain, gains[lvl - 2]!, 1.5);
    }
  }
  // "level 3 is the best choice for most films, level 5 never best" (Qm 0.62, hype cap 0.31)
  const levels = compareMarketingLevels(estimateInput({ qualityOverride: 0.62, hype: 0.31, techPioneer: true, symmetricImbalance: true }));
  const best = levels.reduce((b, l, i) => (l.netBoxOffice > levels[b]!.netBoxOffice ? i : b), 0);
  assert.equal(best, 2);
});

test("the code's one-sided imbalance term against the symmetric reading", () => {
  // with hype above D (no marketing, high hype) the baseline is better than the symmetric reading says; only the hype > D side differs
  const code = estimateInput({ qualityOverride: 0.62, hype: 0.31, marketingLevel: 1 });
  assert.ok(estimateMovie(code).boxOffice > estimateMovie({ ...code, symmetricImbalance: true }).boxOffice);
  near("with D above hype (level 5) both agree", estimateMovie({ ...code, marketingLevel: 5 }).boxOffice, estimateMovie({ ...code, marketingLevel: 5, symmetricImbalance: true }).boxOffice, 1e-3);
});

test("a logged PR release through the whole chain (MOVIE_SUCCESS.md 3u / 3v)", () => {
  const r = estimateMovie(estimateInput({ qualityOverride: 0.6208, hype: 0.3104, marketingLevel: 5 }));
  near("D", r.marketingD, 0.6896, 1e-4);
  near("logged PI", r.factors.publicInterest, 1.3352, 1e-4);
});
