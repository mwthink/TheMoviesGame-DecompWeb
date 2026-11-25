// Movie success and box-office revenue.
//
// From CProjectSuccess_Recompute and its factor functions, CProject_ComputeMovieStarRating, the public-interest / marketing helpers, the genre trend
// and saturation tracker, and CProjectIncome. Derivation, constants and measured checks: docs/MOVIE_SUCCESS.md.
//
// Pure arithmetic on already-gathered numbers (the movie's quality Qm, the stars' ratings, the boredom values, ...). Times are decimal game years
// (1931.748); the game stores a clock and converts with Time_ToYears. "verified" means tests/sim/movieSuccess.test.ts reproduces values the running
// game logged (docs/MOVIE_SUCCESS.md 3j, 3u, 3v). Values the original stores as float go through Math.fround.
import { clamp01, diminishingBonus } from "./MovieQuality.ts";

const f32 = Math.fround;

/**
 * Tuning: Data\releasing_movies.ini ([min_max], [success_overall], [revenue], [pr]), global.ini ([project], [genre]), timeline.csv, misc_costs.ini.
 * The defaults are the shipped values.
 */
export interface SuccessTuning {
  publicInterestMin: number; // public_interest_min
  publicInterestMax: number; // public_interest_max
  /** public_interest_ratio: weight of the hype/marketing imbalance */
  publicInterestRatio: number;
  starRatingsMin: number; // star_ratings_of_cast_min
  starRatingsMax: number; // star_ratings_of_cast_max
  /** star_ratings_proportion: weight of the best star, squared for each next one */
  starRatingsProportion: number;
  genrePopularityMin: number; // genre_popularity_min
  genrePopularityMax: number; // genre_popularity_max
  /** genre_boredom_bound: floor of the saturation factor */
  genreBoredomBound: number;
  setBoredomBound: number; // set_boredom_bound
  /** star_boredom_bound (extras use it too) */
  starBoredomBound: number;
  technologyPioneeringBonus: number; // technology_pioneering_bonus
  overallShifterMidPoint: number; // success_overall_shifter_mid_point
  overallMaxShifter: number; // success_overall_max_shifter
  overallMaxAdder: number; // success_overall_max_adder
  starRatingBoxOffice: number; // global.ini [project] starratingboxoffice
  starRatingQuality: number; // starratingquality
  starRatingAwards: number; // starratingawards
  revenueMultiplier: number; // revenue_multiplier
  revenueBase: number; // revenue_base
  /** pi_effect: how much public interest changes the payout rate */
  piEffect: number;
  adderPercentage: number; // adder_percentage
  basePercentage: number; // base_percentage
  /** increase_percentage (negative: the daily rate decays) */
  increasePercentage: number;
  genreBoredomBoost: number; // global.ini [genre] boredomboost
  /** [genre] boredomhalflife, years */
  genreBoredomHalfLife: number;
  /** timeline.csv [constants] halflife, years */
  trendHalfLife: number;
  /** misc_costs.ini [project]: what a marketing level costs at release, by level 0..5 (level 0 has no entry: free) */
  marketingSpendCost: number[];
}

export function defaultSuccessTuning(): SuccessTuning {
  return {
    publicInterestMin: f32(1.0), publicInterestMax: f32(1.4), publicInterestRatio: f32(0.3),
    starRatingsMin: f32(0.8), starRatingsMax: f32(1.2), starRatingsProportion: f32(0.7),
    genrePopularityMin: f32(0.9), genrePopularityMax: f32(1.2), genreBoredomBound: f32(0.8),
    setBoredomBound: f32(0.8), starBoredomBound: f32(0.8), technologyPioneeringBonus: f32(1.1),
    overallShifterMidPoint: f32(0.5), overallMaxShifter: f32(0.12), overallMaxAdder: f32(0.8),
    starRatingBoxOffice: f32(0.73), starRatingQuality: f32(0.33), starRatingAwards: f32(0),
    revenueMultiplier: f32(1400000), revenueBase: f32(70000), piEffect: f32(0.6),
    adderPercentage: f32(0.0005), basePercentage: f32(0.013), increasePercentage: f32(-0.004),
    genreBoredomBoost: f32(0.15), genreBoredomHalfLife: f32(2), trendHalfLife: f32(4),
    marketingSpendCost: [0, 0, 50000, 100000, 150000, 200000],
  };
}

const DEFAULT = defaultSuccessTuning();

/** The five market factors of a released movie (CProjectSuccess +0x94 .. +0xA4). */
export interface SuccessFactors {
  /** TP, +0xA4: 1.1 or 1.0 */
  techPioneering: number;
  /** SR, +0x98: 0.8..1.2 */
  starRatings: number;
  /** GP, +0x9C: 0.72..1.2 */
  genrePopularity: number;
  /** BO, +0xA0: 0.8..1.0 */
  boredom: number;
  /** PI, +0x94: 1.0..1.4 */
  publicInterest: number;
}

export function successFactors(p: Partial<SuccessFactors> = {}): SuccessFactors {
  return { techPioneering: 1, starRatings: 1, genrePopularity: 1, boredom: 1, publicInterest: 1, ...p };
}

/** The result of CProjectSuccess_ComputeBoredomFactor. */
export interface BoredomResult {
  /** BO; 0 when there is nothing to average */
  factor: number;
  /** the plain mean of the ingredients' boredom, 0..1 (display value for the release screen) */
  meanBoredom: number;
}

// ---- Public interest ----

/**
 * MarketingSpend_GetCost: the price of a marketing level (0..5), charged once at release. Levels 0 and 1 are free and give no benefit; anything outside
 * 0..5 costs nothing. orig: 0x005C8B90
 */
export function marketingSpendCost(marketingLevel: number, t: SuccessTuning = DEFAULT): number {
  if (marketingLevel < 0 || marketingLevel > 5) return 0;
  return t.marketingSpendCost[marketingLevel] ?? 0;
}

/** CProject_GetCappedHype: hype only counts up to half the movie's quality. orig: 0x005B2BD0 */
export function cappedHype(hype: number, qm: number): number {
  const cap = f32(clamp01(f32(qm * 0.5)));
  return hype <= cap ? hype : cap;
}

/**
 * CProject_ComputePublicInterestMarketing: the marketing term "D", frozen at release. level is MarketingSpendLevel (0..5; 0 and 1 give nothing).
 * onTheRadar is award bonus 0 (public awareness), which pulls D halfway toward clamp01(Qm - hype). orig: 0x005B29E0 verified
 */
export function marketingPublicInterest(cappedHypeValue: number, qm: number, marketingLevel: number, onTheRadar: boolean): number {
  let d = f32(1 - cappedHypeValue);
  switch (marketingLevel) {
    case 2: d = f32(d * 0.25); break;
    case 3: d = f32(d * 0.5); break;
    case 4: d = f32(d * 0.75); break;
    case 5: break;
    default: d = 0; break; // none and "lowest" give no bonus
  }
  if (onTheRadar) {
    let hype = cappedHypeValue;
    const cap = f32(clamp01(f32(qm * 0.5)));
    if (cap < hype) hype = cap;
    const target = f32(clamp01(f32(qm - hype)));
    if (target !== d) d = f32(d - f32(f32(d - target) * 0.5));
  }
  if (d < 0) return 0;
  if (d > 1) return 1;
  return d;
}

/**
 * CProjectSuccess_ComputePublicInterestFactor: F in 0..1, how well hype and marketing cover the movie's quality. The decompiler's parameter order is
 * unreliable; the mapping (hype, D, Qm) is the one that reproduces the logged values.
 * quirk: the imbalance term is one-sided in the code: it takes |clamp01(D - hype)|, so a surplus of hype over D is not counted as imbalance.
 * symmetricImbalance = true uses |hype - D| instead, which is how the older notes (and the table in MOVIE_SUCCESS.md 3w) read it; the two differ only
 * when hype exceeds D, which no logged release had. orig: 0x005DCFD0 verified
 */
export function publicInterestCoverage(cappedHypeValue: number, marketingD: number, qm: number, t: SuccessTuning = DEFAULT, symmetricImbalance = false): number {
  let hype = cappedHypeValue;
  const halfQuality = f32(clamp01(f32(qm * 0.5)));
  if (halfQuality < hype) hype = halfQuality;

  const rawSum = f32(marketingD + hype);
  const total = f32(clamp01(rawSum)); // total publicity

  let cover = 0;
  if (qm !== 0) {
    let missed: number;
    if (total > qm) missed = f32(Math.pow(f32(clamp01(f32(total - qm))), 3)); // too much publicity: cubic penalty
    else missed = f32(f32(clamp01(f32(qm - total))) / qm);
    cover = f32(1 - missed);
  }

  let imbalance = 0;
  if (rawSum > 0) {
    const gap = symmetricImbalance ? Math.abs(f32(marketingD - hype)) : Math.abs(f32(clamp01(f32(marketingD - hype))));
    imbalance = f32(gap / f32(clamp01(f32(marketingD + hype))));
  }
  return f32(f32(1 - f32(t.publicInterestRatio * imbalance)) * cover);
}

/** The player's movie: PI = min + (max - min) * F. */
export function publicInterestFactor(coverage: number, t: SuccessTuning = DEFAULT): number {
  return f32(f32(f32(t.publicInterestMax - t.publicInterestMin) * coverage) + t.publicInterestMin);
}

/**
 * CProjectSuccess_ComputePublicInterestFactorAI: AI movies use their own hype and quality directly; PI is 1.0 .. 1.12.
 * AI hype is not capped by quality, so over-hyped AI movies are penalised. orig: 0x005DD2D0 verified
 */
export function publicInterestFactorAI(hype: number, quality: number, t: SuccessTuning = DEFAULT): number {
  let missed: number;
  if (hype > quality || quality === 0) missed = f32(Math.pow(f32(clamp01(f32(hype - quality))), 3));
  else missed = f32(f32(clamp01(f32(quality - hype))) / quality);
  return f32(f32(f32(f32(t.publicInterestRatio * f32(1 - missed)) * f32(t.publicInterestMax - t.publicInterestMin))) + t.publicInterestMin);
}

// ---- Other factors ----

/**
 * CProjectSuccess_ComputeCastStarRatingsFactor: the stars (and a star director) sorted best first, weighted proportion, proportion^2, proportion^4, ...
 * so the third star barely counts. Better movies need bigger stars for the same bonus. orig: 0x005DE8F0
 */
export function castStarRatingsFactor(starRatings: readonly number[], qm: number, t: SuccessTuning = DEFAULT): number {
  const sorted = [...starRatings].sort((a, b) => b - a);
  let sum = 0;
  let weight = t.starRatingsProportion;
  for (const rating of sorted) {
    sum = f32(sum + f32(clamp01(f32(weight * rating))));
    weight = f32(weight * weight);
  }
  if (qm < f32(0.2)) qm = f32(0.2);
  const x = f32(clamp01(f32(sum / f32(f32(qm * 3) - f32(0.3)))));
  return f32(f32(clamp01(f32(f32(t.starRatingsMax - t.starRatingsMin) * x))) + t.starRatingsMin);
}

/**
 * Release_ComputeGenrePopularityAndSaturation: trend is the audience taste 0..1, saturation the genre tracker's value 0..1. trendOverride replaces the
 * trend while the Trendsetter award bonus is active (pass < 0 for none; the game uses 1.0). orig: 0x005DD3D0 verified
 */
export function genrePopularity(trend: number, saturation: number, trendOverride = -1, t: SuccessTuning = DEFAULT): number {
  const effectiveTrend = trendOverride >= 0 ? trendOverride : trend;
  const popularity = f32(f32(f32(t.genrePopularityMax - t.genrePopularityMin) * effectiveTrend) + t.genrePopularityMin);
  const freshness = f32(1 - f32(clamp01(saturation)));
  return f32(popularity * f32(t.genreBoredomBound + f32(f32(1 - t.genreBoredomBound) * freshness)));
}

/**
 * CProjectSuccess_ComputeBoredomFactor: the mean of (1 - b) * (1 - bound) + bound over the movie's sets and its cast and director. The Brainwasher bonus
 * (award bonus 3) multiplies each set's boredom first: pass the boredoms already adjusted. orig: 0x005DE3F0 verified
 */
export function boredomFactor(setBoredom: readonly number[], castBoredom: readonly number[], t: SuccessTuning = DEFAULT): BoredomResult {
  const n = setBoredom.length + castBoredom.length;
  if (n === 0) return { factor: 0, meanBoredom: 0 };
  let termSum = 0;
  let boredomSum = 0;
  for (const b of setBoredom) {
    boredomSum = f32(boredomSum + b);
    termSum = f32(termSum + f32(f32(f32(1 - b) * f32(1 - t.setBoredomBound)) + t.setBoredomBound));
  }
  for (const b of castBoredom) {
    boredomSum = f32(boredomSum + b);
    termSum = f32(termSum + f32(f32(f32(1 - b) * f32(1 - t.starBoredomBound)) + t.starBoredomBound));
  }
  const inv = f32(1 / n);
  return { meanBoredom: f32(clamp01(f32(boredomSum * inv))), factor: f32(inv * termSum) };
}

/** CProjectSuccess_GetTechPioneeringFactor. orig: 0x005DD570 */
export function techPioneeringFactor(pioneerTechnologyActive: boolean, t: SuccessTuning = DEFAULT): number {
  return pioneerTechnologyActive ? t.technologyPioneeringBonus : 1;
}

// ---- Success and rating ----

/**
 * CProjectSuccess_Recompute: S = max(0, Qm + g(x)) with the same diminishing-returns shape as the quality rating. S is not capped at 1.
 * quirk: a Qm outside [-1e-6, 1.000001] is replaced by 1.0, not clamped. orig: 0x005DEDC0 verified
 */
export function computeSuccess(qm: number, f: SuccessFactors, t: SuccessTuning = DEFAULT): number {
  if (qm < f32(-1e-6) || qm > f32(1.000001)) qm = 1;
  const production = f32(f32(f32(f32(f.techPioneering * f.starRatings) * f.genrePopularity) * f.boredom) * f.publicInterest);
  const offset = f32(qm - t.overallShifterMidPoint);
  const x = f32(f32(f32(production - 1) + f32(f32(f32(offset + offset) * -1) * t.overallMaxShifter)) * t.overallMaxAdder);
  const s = f32(diminishingBonus(x) + qm);
  return s < 0 ? 0 : s;
}

/** CProject_ComputeMovieStarRating: the rating shown on the release screen and used for awards, mostly box office. orig: 0x005B8C90 verified */
export function movieStarRating(success: number, qm: number, hasAward: boolean, t: SuccessTuning = DEFAULT): number {
  let r = f32(clamp01(f32(t.starRatingBoxOffice * f32(clamp01(success)))));
  r = f32(clamp01(f32(f32(t.starRatingQuality * qm) + r)));
  r = f32(clamp01(f32(f32(t.starRatingAwards * (hasAward ? 1 : 0)) + r)));
  return r;
}

// ---- Revenue ----

/**
 * The CProjectIncome fields that drive the payout. Money here is plain dollars in double precision; the game uses 64-bit fixed point with 23 fractional
 * bits.
 */
export interface IncomeRecord {
  /** +0x90 money still to be paid out */
  pool: number;
  /** +0x98 */
  initialPool: number;
  /** +0xA0 the daily random extra is 0..this */
  adderMaximum: number;
  /** +0xA8 */
  dailyPercentage: number;
  /** +0xAC */
  dailyMultiplier: number;
}

function makeIncome(success: number, interest: number, emptyPool: boolean, t: SuccessTuning): IncomeRecord {
  const initialPool = t.revenueMultiplier * Math.pow(success, 2) + t.revenueBase;
  // piFactor: with no public interest the payout rate is (1 - pi_effect) of its maximum.
  const piFactor = (1 - t.piEffect) + t.piEffect * interest;
  return {
    initialPool,
    pool: emptyPool ? 0 : initialPool,
    adderMaximum: initialPool * t.adderPercentage,
    dailyPercentage: t.basePercentage * piFactor,
    dailyMultiplier: 1 + t.increasePercentage * piFactor,
  };
}

/** CProjectIncome_CreateForPlayerProject: interest is clamp01(D + cappedHype) of the player's movie. orig: 0x005CDB80 verified */
export function createPlayerIncome(success: number, marketingD: number, cappedHypeValue: number, t: SuccessTuning = DEFAULT): IncomeRecord {
  return makeIncome(success, f32(clamp01(f32(marketingD + cappedHypeValue))), false, t);
}

/** CProjectIncome_CreateForAIProject: the AI movie's hype is its interest; backCatalog gives an empty pool. orig: 0x005CDD90 verified */
export function createAIIncome(success: number, hype: number, backCatalog: boolean, t: SuccessTuning = DEFAULT): IncomeRecord {
  return makeIncome(success, hype, backCatalog, t);
}

/**
 * CProjectIncome_DailyTick, the payout part: pays pool * dailyPercentage plus randomUnit (0..1) * adderMaximum, never more than what is left, then lets
 * the daily rate decay. Returns the amount paid. The original also starts the archive timer and a Tannoy when the pool reaches zero (not modelled).
 * orig: 0x005CCE10
 */
export function dailyPayout(income: IncomeRecord, randomUnit: number): number {
  if (income.pool === 0) return 0;
  let payout = income.pool * income.dailyPercentage + randomUnit * income.adderMaximum;
  if (payout >= income.pool) payout = income.pool; // the last day pays out the remainder
  income.pool -= payout;
  income.dailyPercentage *= income.dailyMultiplier;
  return payout;
}

// ---- Genre trend and saturation ----

/** One dated event of the audience taste timeline (value 1 = the genre becomes popular, 0 = unpopular). */
export interface TasteEvent {
  year: number;
  value: number;
}

/**
 * AudienceTaste_GetGenreTrend: the latest event with year <= now sets the trend, which then drifts back toward 0.5 with a half-life of trendHalfLife
 * years. No event yet: 0.5. Events must be sorted by year. orig: 0x005216E0 verified
 */
export function genreTrend(events: readonly TasteEvent[], nowYear: number, t: SuccessTuning = DEFAULT): number {
  let latest: TasteEvent | undefined;
  for (const e of events) {
    if (e.year > nowYear) break;
    latest = e;
  }
  if (!latest) return f32(0.5);
  const decay = Math.pow(2, -(nowYear - latest.year) / t.trendHalfLife);
  return f32(clamp01(f32(0.5 + (latest.value - 0.5) * decay)));
}

/** A value that decays exponentially with a half-life (DecayValue). Used for boredom and genre saturation. */
export class DecayValue {
  stampYear: number;
  value0: number;
  halfLifeYears: number;

  constructor(stampYear = 0, value0 = 0, halfLifeYears = 1) {
    this.stampYear = stampYear;
    this.value0 = value0;
    this.halfLifeYears = halfLifeYears;
  }

  /** orig: 0x00494FC0 verified */
  current(nowYear: number): number {
    if (this.value0 === 0) return this.value0;
    return this.value0 * Math.pow(2, -(nowYear - this.stampYear) / this.halfLifeYears);
  }

  /** orig: 0x004950C0 */
  clamped01(nowYear: number): number {
    const v = this.current(nowYear);
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  /** orig: 0x004950A0 */
  add(amount: number, nowYear: number): void {
    this.value0 = this.current(nowYear) + amount;
    this.stampYear = nowYear;
  }
}

/**
 * GenreSaturationTracker_Push, the amount part: nothing is recorded before 1930, then the effect ramps up linearly to full size by 1940. Returns 0 when
 * nothing would be recorded. orig: 0x0044D120
 */
export function saturationPushAmount(nowYear: number, weight = 1, t: SuccessTuning = DEFAULT): number {
  const years = nowYear - 1920;
  if (years <= 10) return 0;
  const ramp = f32(clamp01(f32((years - 10) * 0.1)));
  return f32(f32(t.genreBoredomBoost * ramp) * weight);
}
