// A whole-movie estimate: chains the quality, success and revenue modules from plain inputs.
//
// A calculator built from the ported formulas, not a port of one game function: "what quality, success and box office would a movie with these
// ingredients get?" and "which marketing level pays best?". The movie is one pre-production record and `shots` identical shots; per-shot variation,
// award quality boosts and release timing are not modelled.
import {
  computeFinalQuality, computeQuality, crewFactor, defaultQualityTuning, productionFactors, setConditionFactor, starRelationshipFactor, type QualityTuning,
} from "./MovieQuality.ts";
import {
  boredomFactor, cappedHype, castStarRatingsFactor, computeSuccess, createPlayerIncome, dailyPayout, defaultSuccessTuning, genrePopularity,
  marketingPublicInterest, marketingSpendCost, movieStarRating, publicInterestCoverage, publicInterestFactor, successFactors, techPioneeringFactor,
  type SuccessFactors, type SuccessTuning,
} from "./MovieSuccess.ts";

const f32 = Math.fround;

export interface EstimateInput {
  // ---- quality ----
  /** 0..1 (3 stars = 0.6) */
  scriptQuality: number;
  /** the mean actor performance (about 1.0 for average actors, see ActorPerformance) */
  castPerformance: number;
  /** the mean relationship between the cast stars (0.5 = neutral); see starChemistry */
  chemistry: number;
  /** a movie with no counted stars gets the worst relationship factor (0.8) */
  hasStars: boolean;
  /** 0..1, 1 = new */
  setRepair: number;
  /** the mean "Movies" trait of the crew (0.5 gives the neutral crew factor 1.0) */
  crewMoviesTrait: number;
  /** project updates spent in pre-production (3000 = the full pre-production weight) */
  preProductionTicks: number;
  /** the pre-production record's quality; < 0: the same as a shot */
  preProductionQuality: number;
  shots: number;
  /** >= 0: skip the quality chain and use this as the movie's quality Qm */
  qualityOverride: number;
  // ---- market ----
  /** the cast stars' ratings (and a star director's) */
  starRatings: number[];
  /** the audience's taste for the genre, 0..1 */
  genreTrend: number;
  /** 0..1 */
  genreSaturation: number;
  /** the Trendsetter award bonus is active (the trend is forced to trendsetterValue) */
  trendsetter: boolean;
  trendsetterValue: number;
  /** the boredom of each set used (0..1); empty: one fresh set */
  setBoredom: number[];
  /** the boredom of each cast member and the director */
  castBoredom: number[];
  techPioneer: boolean;
  /** accumulated PR hype 0..1 (only half the quality counts) */
  hype: number;
  /** 0..5 */
  marketingLevel: number;
  onTheRadar: boolean;
  /** see publicInterestCoverage */
  symmetricImbalance: boolean;
}

export function estimateInput(p: Partial<EstimateInput> = {}): EstimateInput {
  return {
    scriptQuality: f32(0.6), castPerformance: 1, chemistry: 0.5, hasStars: true, setRepair: 1, crewMoviesTrait: 0.5, preProductionTicks: 3000,
    preProductionQuality: -1, shots: 1, qualityOverride: -1, starRatings: [], genreTrend: 0.5, genreSaturation: 0, trendsetter: false, trendsetterValue: 1,
    setBoredom: [], castBoredom: [], techPioneer: false, hype: 0, marketingLevel: 1, onTheRadar: false, symmetricImbalance: false, ...p,
  };
}

export interface EstimateResult {
  shotQuality: number;
  /** Qm */
  finalQuality: number;
  factors: SuccessFactors;
  cappedHype: number;
  marketingD: number;
  /** F */
  coverage: number;
  /** S */
  success: number;
  starRating: number;
  /** the revenue pool: everything the movie will pay out */
  boxOffice: number;
  marketingCost: number;
  /** box office minus the marketing cost */
  netBoxOffice: number;
  /** the share of the pool paid out within 360 days (average random extra) */
  firstYearShare: number;
}

export function estimateMovie(input: EstimateInput, success: SuccessTuning = defaultSuccessTuning(), quality: QualityTuning = defaultQualityTuning()): EstimateResult {
  let shotQuality: number;
  let finalQuality: number;
  if (input.qualityOverride >= 0) {
    shotQuality = finalQuality = f32(input.qualityOverride);
  } else {
    shotQuality = computeQuality(productionFactors({
      castPerformance: f32(input.castPerformance),
      scriptQuality: f32(input.scriptQuality),
      starRelationship: starRelationshipFactor(input.hasStars ? f32(input.chemistry) : 0, input.hasStars ? 1 : 0, quality),
      setCondition: setConditionFactor(f32(input.setRepair), quality),
      crew: crewFactor(f32(input.crewMoviesTrait), quality),
    }), quality);
    const shots = Array.from({ length: input.shots > 0 ? input.shots : 1 }, () => ({ weight: 1, quality: shotQuality }));
    finalQuality = computeFinalQuality({
      hasPreProduction: true,
      ticksInPreProduction: input.preProductionTicks,
      preProductionQuality: input.preProductionQuality >= 0 ? f32(input.preProductionQuality) : shotQuality,
      shots,
    }, quality);
  }
  const qm = finalQuality;

  const capped = cappedHype(f32(input.hype), qm);
  const marketingD = marketingPublicInterest(capped, qm, input.marketingLevel, input.onTheRadar);
  const coverage = publicInterestCoverage(capped, marketingD, qm, success, input.symmetricImbalance);

  const factors = successFactors({
    publicInterest: publicInterestFactor(coverage, success),
    starRatings: castStarRatingsFactor(input.starRatings.map(f32), qm, success),
    genrePopularity: genrePopularity(f32(input.genreTrend), f32(input.genreSaturation), input.trendsetter ? f32(input.trendsetterValue) : -1, success),
    boredom: boredomFactor(input.setBoredom.length ? input.setBoredom.map(f32) : [0], input.castBoredom.map(f32), success).factor,
    techPioneering: techPioneeringFactor(input.techPioneer, success),
  });

  const s = computeSuccess(qm, factors, success);
  const income = createPlayerIncome(s, marketingD, capped, success);
  const boxOffice = income.initialPool;
  const marketingCost = marketingSpendCost(input.marketingLevel, success);
  let paid = 0;
  for (let day = 0; day < 360; day++) paid += dailyPayout(income, 0.5);
  return {
    shotQuality, finalQuality, factors, cappedHype: capped, marketingD, coverage, success: s, starRating: movieStarRating(s, qm, false, success),
    boxOffice, marketingCost, netBoxOffice: boxOffice - marketingCost, firstYearShare: boxOffice > 0 ? paid / boxOffice : 0,
  };
}

/** The same movie at every marketing level 1..5 (levels 0 and 1 are equivalent: no benefit, no cost). result[i] is level i + 1. */
export function compareMarketingLevels(input: EstimateInput, success: SuccessTuning = defaultSuccessTuning(), quality: QualityTuning = defaultQualityTuning()): EstimateResult[] {
  return [1, 2, 3, 4, 5].map((marketingLevel) => estimateMovie({ ...input, marketingLevel }, success, quality));
}
