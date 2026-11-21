#include "game/movie/MovieEstimate.hpp"

namespace otm::movie {

EstimateResult EstimateMovie(const EstimateInput& in, const SuccessTuning& success, const QualityTuning& quality) {
    EstimateResult r;

    // quality
    if (in.qualityOverride >= 0.0f) {
        r.shotQuality = r.finalQuality = in.qualityOverride;
    } else {
        ProductionFactors f;
        f.castPerformance = in.castPerformance;
        f.scriptQuality = in.scriptQuality;
        f.starRelationship = StarRelationshipFactor(in.hasStars ? in.chemistry : 0.0f, in.hasStars ? 1 : 0, quality);
        f.setCondition = SetConditionFactor(in.setRepair, quality);
        f.crew = CrewFactor(in.crewMoviesTrait, quality);
        r.shotQuality = ComputeQuality(f, quality);

        FinalQualityInput q;
        q.hasPreProduction = true;
        q.ticksInPreProduction = in.preProductionTicks;
        q.preProductionQuality = in.preProductionQuality >= 0.0f ? in.preProductionQuality : r.shotQuality;
        const int shots = in.shots > 0 ? in.shots : 1;
        for (int i = 0; i < shots; ++i) q.shots.push_back({1, r.shotQuality});
        r.finalQuality = ComputeFinalQuality(q, quality);
    }
    const float qm = r.finalQuality;

    // public interest
    r.cappedHype = CappedHype(in.hype, qm);
    r.marketingD = MarketingPublicInterest(r.cappedHype, qm, in.marketingLevel, in.onTheRadar, success);
    r.coverage = PublicInterestCoverage(r.cappedHype, r.marketingD, qm, success, in.symmetricImbalance);

    // the five market factors
    SuccessFactors& m = r.factors;
    m.publicInterest = PublicInterestFactor(r.coverage, success);
    m.starRatings = CastStarRatingsFactor(in.starRatings, qm, success);
    m.genrePopularity = GenrePopularity(in.genreTrend, in.genreSaturation, in.trendsetter ? in.trendsetterValue : -1.0f, success);
    const std::vector<float> freshSet = {0.0f};
    m.boredom = BoredomFactor(in.setBoredom.empty() ? freshSet : in.setBoredom, in.castBoredom, success).factor;
    m.techPioneering = TechPioneeringFactor(in.techPioneer, success);

    r.success = ComputeSuccess(qm, m, success);
    r.starRating = MovieStarRating(r.success, qm, false, success);

    IncomeRecord income = CreatePlayerIncome(r.success, r.marketingD, r.cappedHype, success);
    r.boxOffice = income.initialPool;
    r.marketingCost = MarketingSpendCost(in.marketingLevel, success);
    r.netBoxOffice = r.boxOffice - r.marketingCost;
    double paid = 0.0;
    for (int day = 0; day < 360; ++day) paid += DailyPayout(income, 0.5);
    r.firstYearShare = r.boxOffice > 0.0 ? paid / r.boxOffice : 0.0;
    return r;
}

std::vector<EstimateResult> CompareMarketingLevels(const EstimateInput& in, const SuccessTuning& success, const QualityTuning& quality) {
    std::vector<EstimateResult> out;
    for (int level = 1; level <= 5; ++level) {
        EstimateInput i = in;
        i.marketingLevel = level;
        out.push_back(EstimateMovie(i, success, quality));
    }
    return out;
}

}  // namespace otm::movie
