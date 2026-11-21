// A whole-movie estimate: chains the quality, success and revenue modules from plain inputs.
//
// This is a calculator built from the reimplemented formulas, not a port of one game function: it answers "what quality,
// success and box office would a movie with these ingredients get?" and "which marketing level pays best?". The movie is
// modelled as one pre-production record and `shots` identical shots; per-shot variation, award quality boosts and the
// timing of releases are not modelled.
#pragma once

#include <vector>

#include "game/movie/MovieQuality.hpp"
#include "game/movie/MovieSuccess.hpp"

namespace otm::movie {

struct EstimateInput {
    // ---- quality ----
    float scriptQuality = 0.6f;       // 0..1 (3 stars = 0.6)
    float castPerformance = 1.0f;     // mean actor performance (about 1.0 for average actors, see ActorPerformance)
    float chemistry = 0.5f;           // mean relationship value between the cast stars (0.5 = neutral); see StarChemistry
    bool hasStars = true;             // a movie with no counted stars gets the worst relationship factor (0.8)
    float setRepair = 1.0f;           // 0..1, 1 = new
    float crewMoviesTrait = 0.5f;     // mean "Movies" trait of the crew (0.5 gives the neutral crew factor 1.0)
    unsigned preProductionTicks = 3000;  // project updates spent in pre-production (3000 = the full pre-production weight)
    float preProductionQuality = -1.0f;  // quality of the pre-production record; < 0: the same as a shot
    int shots = 1;
    float qualityOverride = -1.0f;    // >= 0: skip the quality chain and use this as the movie's quality Qm

    // ---- market ----
    std::vector<float> starRatings;   // the cast stars' ratings (and a star director's)
    float genreTrend = 0.5f;          // audience taste for the genre, 0..1
    float genreSaturation = 0.0f;     // 0..1
    bool trendsetter = false;         // Trendsetter award bonus active (trend forced to the bonus value)
    float trendsetterValue = 1.0f;
    std::vector<float> setBoredom;    // boredom of each set used (0..1). Empty: one fresh set
    std::vector<float> castBoredom;   // boredom of each cast member and the director
    bool techPioneer = false;
    float hype = 0.0f;                // accumulated PR hype 0..1 (only half the quality counts)
    int marketingLevel = 1;           // 0..5
    bool onTheRadar = false;
    bool symmetricImbalance = false;  // see PublicInterestCoverage
};

struct EstimateResult {
    float shotQuality = 0.0f;
    float finalQuality = 0.0f;        // Qm
    SuccessFactors factors;
    float cappedHype = 0.0f;
    float marketingD = 0.0f;
    float coverage = 0.0f;            // F
    float success = 0.0f;             // S
    float starRating = 0.0f;
    double boxOffice = 0.0;           // the revenue pool: everything the movie will pay out
    double marketingCost = 0.0;
    double netBoxOffice = 0.0;        // box office minus the marketing cost
    double firstYearShare = 0.0;      // share of the pool paid out within 360 days (average random extra)
};

EstimateResult EstimateMovie(const EstimateInput& in, const SuccessTuning& success = {}, const QualityTuning& quality = {});

// The same movie at every marketing level 1..5 (level 1 and 0 are equivalent: no benefit, no cost). result[i] is level i + 1.
std::vector<EstimateResult> CompareMarketingLevels(const EstimateInput& in, const SuccessTuning& success = {},
                                                   const QualityTuning& quality = {});

}  // namespace otm::movie
