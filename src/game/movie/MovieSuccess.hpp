// Movie success and box-office revenue.
//
// Reimplemented from CProjectSuccess_Recompute and its factor functions, CProject_ComputeMovieStarRating, the
// public-interest / marketing helpers, the genre trend and saturation tracker, and CProjectIncome.
// Derivation, constants and measured checks: docs/MOVIE_SUCCESS.md.
//
// Like MovieQuality this is pure arithmetic on already-gathered numbers (the movie's quality Qm, the stars' ratings, the
// boredom values, ...). Gathering them from game objects comes with the classes that own that data. Times are decimal
// game years (1931.748); the game stores a clock and converts with Time_ToYears.
// "verified" below means tests/MovieSuccessTest.cpp reproduces values the running game logged (docs/MOVIE_SUCCESS.md 3j, 3u,
// 3v) for that function. Functions without it follow the decompiled code or the doc but no logged value isolates them.
// Floats like the original; the x87 80-bit intermediates of the original can make the last bits differ.
#pragma once

#include <vector>

#include "game/movie/MovieQuality.hpp"

namespace otm::movie {

// Tuning constants: Data\releasing_movies.ini ([min_max], [success_overall], [revenue], [pr]), global.ini ([project], [genre]),
// misc_costs.ini. Defaults are the shipped values; loading the ini files is not implemented yet.
struct SuccessTuning {
    float publicInterestMin = 1.0f;          // public_interest_min
    float publicInterestMax = 1.4f;          // public_interest_max
    float publicInterestRatio = 0.3f;        // public_interest_ratio: weight of the hype/marketing imbalance
    float starRatingsMin = 0.8f;             // star_ratings_of_cast_min
    float starRatingsMax = 1.2f;             // star_ratings_of_cast_max
    float starRatingsProportion = 0.7f;      // star_ratings_proportion: weight of the best star, squared for each next one
    float genrePopularityMin = 0.9f;         // genre_popularity_min
    float genrePopularityMax = 1.2f;         // genre_popularity_max
    float genreBoredomBound = 0.8f;          // genre_boredom_bound: floor of the saturation factor
    float setBoredomBound = 0.8f;            // set_boredom_bound
    float starBoredomBound = 0.8f;           // star_boredom_bound (extras use it too)
    float technologyPioneeringBonus = 1.1f;  // technology_pioneering_bonus
    float overallShifterMidPoint = 0.5f;     // success_overall_shifter_mid_point
    float overallMaxShifter = 0.12f;         // success_overall_max_shifter
    float overallMaxAdder = 0.8f;            // success_overall_max_adder
    float starRatingBoxOffice = 0.73f;       // global.ini [project] starratingboxoffice
    float starRatingQuality = 0.33f;         // starratingquality
    float starRatingAwards = 0.0f;           // starratingawards
    float revenueMultiplier = 1400000.0f;    // revenue_multiplier
    float revenueBase = 70000.0f;            // revenue_base
    float piEffect = 0.6f;                   // pi_effect: how much public interest changes the payout rate
    float adderPercentage = 0.0005f;         // adder_percentage
    float basePercentage = 0.013f;           // base_percentage
    float increasePercentage = -0.004f;      // increase_percentage (negative: the daily rate decays)
    float genreBoredomBoost = 0.15f;         // global.ini [genre] boredomboost
    float genreBoredomHalfLife = 2.0f;       // [genre] boredomhalflife, years
    float trendHalfLife = 4.0f;              // timeline.csv [constants] halflife, years
};

// The five market factors of a released movie (CProjectSuccess +0x94 .. +0xA4).
struct SuccessFactors {
    float techPioneering = 1.0f;   // TP, +0xA4: 1.1 or 1.0
    float starRatings = 1.0f;      // SR, +0x98: 0.8..1.2
    float genrePopularity = 1.0f;  // GP, +0x9C: 0.72..1.2
    float boredom = 1.0f;          // BO, +0xA0: 0.8..1.0
    float publicInterest = 1.0f;   // PI, +0x94: 1.0..1.4
};

// Result of CProjectSuccess_ComputeBoredomFactor.
struct BoredomResult {
    float factor = 0.0f;         // BO; 0 when there is nothing to average
    float meanBoredom = 0.0f;    // plain mean of the ingredients' boredom, 0..1 (display value for the release screen)
};

// ---- Public interest ----

// CProject_GetCappedHype: hype only counts up to half the movie's quality.
// orig: 0x005B2BD0
float CappedHype(float hype, float qm);

// CProject_ComputePublicInterestMarketing: the marketing term "D" frozen at release. level is MarketingSpendLevel (0..5;
// 0 and 1 give nothing). onTheRadar is award bonus 0 (public awareness), which pulls D halfway toward clamp01(Qm - hype).
// orig: 0x005B29E0 verified
float MarketingPublicInterest(float cappedHype, float qm, int marketingLevel, bool onTheRadar, const SuccessTuning& t = {});

// CProjectSuccess_ComputePublicInterestFactor: F in 0..1, how well hype and marketing cover the movie's quality.
// The decompiler's parameter order is unreliable; the mapping (hype, D, Qm) is the one that reproduces the logged values.
// orig: 0x005DCFD0 verified
float PublicInterestCoverage(float cappedHype, float marketingD, float qm, const SuccessTuning& t = {});

// Player movie: PI = min + (max - min) * F.
float PublicInterestFactor(float coverage, const SuccessTuning& t = {});

// CProjectSuccess_ComputePublicInterestFactorAI: AI movies use their own hype and quality directly; PI is 1.0 .. 1.12.
// orig: 0x005DD2D0 verified
float PublicInterestFactorAI(float hype, float quality, const SuccessTuning& t = {});

// ---- Other factors ----

// CProjectSuccess_ComputeCastStarRatingsFactor: stars (and a star director) sorted best first, weights proportion,
// proportion^2, proportion^4, ... so the third star barely counts. Better movies need bigger stars for the same bonus.
// orig: 0x005DE8F0
float CastStarRatingsFactor(std::vector<float> starRatings, float qm, const SuccessTuning& t = {});

// Release_ComputeGenrePopularityAndSaturation: trend is the audience taste 0..1, saturation the genre tracker's value 0..1.
// trendOverride replaces the trend while the Trendsetter award bonus is active (pass < 0 for none; the game uses 1.0).
// orig: 0x005DD3D0 verified
float GenrePopularity(float trend, float saturation, float trendOverride = -1.0f, const SuccessTuning& t = {});

// CProjectSuccess_ComputeBoredomFactor: mean of (1 - b) * (1 - bound) + bound over the movie's sets and its cast members and
// director. The Brainwasher bonus (award bonus 3) multiplies each set's boredom first: pass the boredoms already adjusted.
// orig: 0x005DE3F0 verified
BoredomResult BoredomFactor(const std::vector<float>& setBoredom, const std::vector<float>& castBoredom, const SuccessTuning& t = {});

// CProjectSuccess_GetTechPioneeringFactor.
// orig: 0x005DD570
float TechPioneeringFactor(bool pioneerTechnologyActive, const SuccessTuning& t = {});

// ---- Success and rating ----

// CProjectSuccess_Recompute: S = max(0, Qm + g(x)) with the same diminishing-returns shape as the quality rating. S is not
// capped at 1. A Qm outside [-1e-6, 1.000001] is replaced by 1.0.
// orig: 0x005DEDC0 verified
float ComputeSuccess(float qm, const SuccessFactors& f, const SuccessTuning& t = {});

// CProject_ComputeMovieStarRating: the rating shown on the release screen and used for awards, mostly box office.
// orig: 0x005B8C90 verified
float MovieStarRating(float success, float qm, bool hasAward, const SuccessTuning& t = {});

// ---- Revenue ----

// CProjectIncome fields that the payout is driven by (money here is plain float dollars, the game uses 64-bit fixed point
// with 23 fractional bits).
struct IncomeRecord {
    double pool = 0.0;                // +0x90 money still to be paid out
    double initialPool = 0.0;         // +0x98
    double adderMaximum = 0.0;        // +0xA0 the daily random extra is 0..this
    double dailyPercentage = 0.0;     // +0xA8
    double dailyMultiplier = 1.0;     // +0xAC
};

// CProjectIncome_CreateForPlayerProject: interest is clamp01(D + cappedHype) of the player's movie.
// orig: 0x005CDB80 verified
IncomeRecord CreatePlayerIncome(float success, float marketingD, float cappedHype, const SuccessTuning& t = {});

// CProjectIncome_CreateForAIProject: the AI movie's hype is its interest. backCatalog gives an empty pool.
// orig: 0x005CDD90 verified
IncomeRecord CreateAIIncome(float success, float hype, bool backCatalog, const SuccessTuning& t = {});

// CProjectIncome_DailyTick, the payout part: pays pool * dailyPercentage plus randomUnit (0..1) * adderMaximum, never more
// than what is left, then lets the daily rate decay. Returns the amount paid. The original also starts the archive timer
// and Tannoy when the pool reaches zero, which is not modelled.
// orig: 0x005CCE10
double DailyPayout(IncomeRecord& income, double randomUnit);

// ---- Genre trend and saturation ----

// One dated event of the audience taste timeline (value 1 = genre becomes popular, 0 = unpopular).
struct TasteEvent {
    double year = 0.0;
    float value = 0.5f;
};

// AudienceTaste_GetGenreTrend: the latest event with year <= now sets the trend, which then drifts back toward 0.5 with a
// half-life of trendHalfLife years. No event yet: 0.5. Events must be sorted by year.
// orig: 0x005216E0 verified
float GenreTrend(const std::vector<TasteEvent>& events, double nowYear, const SuccessTuning& t = {});

// A value that decays exponentially with a half-life (DecayValue). Used for boredom and genre saturation.
struct DecayValue {
    double stampYear = 0.0;
    double value0 = 0.0;
    double halfLifeYears = 1.0;

    // orig: 0x00494FC0 verified
    double Current(double nowYear) const;
    // orig: 0x004950C0
    double Clamped01(double nowYear) const;
    // orig: 0x004950A0
    void Add(double amount, double nowYear);
};

// GenreSaturationTracker_Push, the amount part: nothing is recorded before 1930, then the effect ramps up linearly to full
// size by 1940. Returns 0 when nothing would be recorded.
// orig: 0x0044D120
float SaturationPushAmount(double nowYear, float weight = 1.0f, const SuccessTuning& t = {});

}  // namespace otm::movie
