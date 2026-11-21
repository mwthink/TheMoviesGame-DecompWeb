// Checks MovieSuccess against the values the running game logged (docs/MOVIE_SUCCESS.md sections 3j, 3u, 3v, 3k) and
// against hand-computed examples for the formulas the logs do not isolate.
#include <cmath>
#include <cstdio>

#include "game/movie/MovieSuccess.hpp"

using namespace otm::movie;

static int g_failures = 0;

static void Near(const char* what, double got, double want, double tol) {
    if (!(std::fabs(got - want) <= tol)) {
        std::printf("FAIL %s: got %.6f, want %.6f (+-%g)\n", what, got, want, tol);
        ++g_failures;
    }
}

int main() {
    // ---- First AI release (1920, romance): q 0.20098, hype 0.2232; logged PI 1.1200, SR 0.9408, S 0.28120 ----
    {
        const float q = 0.20098f, h = 0.2232f;
        Near("AI public interest (hype > quality)", PublicInterestFactorAI(h, q), 1.1200, 1e-4);
        SuccessFactors f;
        f.starRatings = 0.9408f;
        f.publicInterest = 1.1200f;
        Near("AI success (positive bonus branch)", ComputeSuccess(q, f), 0.28120, 1e-4);
        IncomeRecord inc = CreateAIIncome(0.28120f, h, false);
        Near("AI pool", inc.initialPool, 180701.91, 5.0);
        Near("AI adder maximum", inc.adderMaximum, 90.35, 0.05);
        Near("AI daily percentage", inc.dailyPercentage, 0.006941, 1e-6);
        Near("AI daily multiplier", inc.dailyMultiplier, 0.997864, 1e-6);
    }

    // ---- Other AI releases: both public-interest branches ----
    Near("AI PI, hype > quality", PublicInterestFactorAI(0.3492f, 0.18888f), 1.1195, 1e-4);
    Near("AI PI, hype < quality", PublicInterestFactorAI(0.2397f, 0.25548f), 1.1126, 1e-4);

    // ---- Player movie 1 (1922): Qm 0.17509, PI 1 (no PR), SR 0.9299, GP 1.05, BO 1; logged S 0.20992, pool 131,692.80 ----
    {
        SuccessFactors f;
        f.starRatings = 0.9299f;
        f.genrePopularity = 1.05f;
        const float s = ComputeSuccess(0.17509f, f);
        Near("player movie 1 success", s, 0.20992, 1e-4);
        Near("player movie 1 star rating", MovieStarRating(0.20992f, 0.17509f, false), 0.2110, 1e-4);
        IncomeRecord inc = CreatePlayerIncome(0.20992f, 0.0f, 0.0f);
        Near("player movie 1 pool", inc.initialPool, 131692.80, 2.0);
        Near("player movie 1 daily percentage", inc.dailyPercentage, 0.0052, 1e-7);
        Near("player movie 1 daily multiplier", inc.dailyMultiplier, 0.9984, 1e-7);
    }

    // ---- Player movie 2 (negative branch): sets at boredom 1.0 x3, two cast members; logged BO 0.8695, S 0.13427 ----
    {
        // The logged cast boredom mean 0.1309 is one cast member used 0.7856 years earlier (boost 0.3, half-life 4 years)
        // and one new one.
        DecayValue star{0.0, 0.3, 4.0};
        Near("star boredom decays with a 4-year half-life", star.Current(0.7856) / 2.0, 0.1309, 1e-4);
        const BoredomResult b = BoredomFactor({1.0f, 1.0f, 1.0f}, {static_cast<float>(star.Current(0.7856)), 0.0f});
        Near("mean boredom", b.meanBoredom, 0.6524, 1e-4);
        Near("boredom factor", b.factor, 0.8695, 1e-4);
        SuccessFactors f;
        f.starRatings = 0.9607f;
        f.genrePopularity = 1.05f;
        f.boredom = 0.8695f;
        Near("player movie 2 success (negative branch)", ComputeSuccess(0.16907f, f), 0.13427, 1e-4);
        Near("player movie 2 star rating", MovieStarRating(0.13427f, 0.16907f, false), 0.1538, 1e-4);
        IncomeRecord inc = CreatePlayerIncome(0.13427f, 0.0f, 0.0f);
        Near("player movie 2 pool", inc.initialPool, 95240.56, 3.0);
    }

    // ---- Genre trend and popularity ----
    {
        const std::vector<TasteEvent> action = {{1924.5, 1.0f}};
        Near("trend at the event", GenreTrend(action, 1924.5), 1.0, 1e-6);
        Near("trend 0.357 years after a popular event", GenreTrend(action, 1924.857), 0.9700, 1e-4);
        Near("trend before any event", GenreTrend(action, 1920.0), 0.5, 0.0);
        Near("trend after an unpopular event", GenreTrend({{1927.7, 0.0f}}, 1927.7 + 4.0), 0.25, 1e-6);
        Near("only the latest event counts", GenreTrend({{1927.7, 0.0f}, {1929.8, 1.0f}}, 1929.8), 1.0, 1e-6);
        Near("popularity, neutral trend, no saturation", GenrePopularity(0.5f, 0.0f), 1.05, 1e-6);
        Near("player movie 4 (action 1924.82)", GenrePopularity(0.97303f, 0.0f), 1.1919, 1e-4);
        // Trendsetter active: the trend is forced to 1.0, only saturation differs.
        Near("trendsetter, horror", GenrePopularity(0.1f, 0.1697f, 1.0f), 1.1593, 1e-4);
        Near("trendsetter, romance", GenrePopularity(0.1f, 0.2478f, 1.0f), 1.1405, 1e-4);
        Near("fully saturated genre", GenrePopularity(0.5f, 1.0f), 1.05 * 0.8, 1e-6);
    }

    // ---- Marketing and public interest with PR (1945-48 releases): logged D and PI ----
    {
        Near("D, level 3", MarketingPublicInterest(0.3082f, 0.62f, 3, false), 0.3459, 1e-4);
        Near("D, level 4", MarketingPublicInterest(0.2989f, 0.5978f, 4, false), 0.5258, 1e-4);
        Near("D, level 5", MarketingPublicInterest(0.3104f, 0.6208f, 5, false), 0.6896, 1e-4);
        Near("D, level 1 gives nothing", MarketingPublicInterest(0.3f, 0.6f, 1, false), 0.0, 0.0);
        Near("D, no marketing", MarketingPublicInterest(0.3f, 0.6f, 0, false), 0.0, 0.0);
        Near("PI release 1", PublicInterestFactor(PublicInterestCoverage(0.3104f, 0.6896f, 0.6208f)), 1.3352, 1e-4);
        Near("PI release 2", PublicInterestFactor(PublicInterestCoverage(0.2989f, 0.5258f, 0.5978f)), 1.3627, 1e-4);
        Near("PI without PR", PublicInterestFactor(PublicInterestCoverage(0.0f, 0.0f, 0.6f)), 1.0, 1e-6);
        Near("capped hype", CappedHype(0.74f, 0.6f), 0.3, 1e-6);
        Near("hype below the cap", CappedHype(0.1f, 0.6f), 0.1, 1e-6);
        // Qm 0.6, hype 0.3 and D 0.3: publicity exactly covers the quality, no imbalance: the doc's best case.
        Near("PI best case", PublicInterestFactor(PublicInterestCoverage(0.3f, 0.3f, 0.6f)), 1.4, 1e-5);
    }

    // ---- Cast star ratings (hand-computed from the formula; the logs only give the resulting SR) ----
    {
        Near("no stars", CastStarRatingsFactor({}, 0.6f), 0.8, 1e-6);
        // one star rated 0.6: sum = 0.7 * 0.6 = 0.42; x = 0.42 / (3 * 0.6 - 0.3) = 0.28; SR = 0.8 + 0.4 * 0.28 = 0.912
        Near("one star", CastStarRatingsFactor({0.6f}, 0.6f), 0.912, 1e-5);
        // weights 0.7, 0.49, 0.2401: ratings given in any order are sorted best first
        const float expectedSum = 0.7f * 0.9f + 0.49f * 0.5f + 0.2401f * 0.2f;
        Near("three stars, unsorted", CastStarRatingsFactor({0.2f, 0.9f, 0.5f}, 0.6f), 0.8 + 0.4 * (expectedSum / 1.5f), 1e-5);
        Near("quality floor of 0.2 for the divisor", CastStarRatingsFactor({0.5f}, 0.0f), 1.2, 1e-6);
        Near("big stars saturate", CastStarRatingsFactor({1.0f, 1.0f, 1.0f}, 0.3f), 1.2, 1e-6);
    }

    // ---- Success edge cases ----
    {
        SuccessFactors neutral;
        Near("neutral market", ComputeSuccess(0.5f, neutral), 0.5, 1e-6);  // P = 1 and Qm at the mid point: no change
        SuccessFactors great;
        great.techPioneering = 1.1f;
        great.starRatings = 1.2f;
        great.genrePopularity = 1.2f;
        great.publicInterest = 1.4f;
        const float s = ComputeSuccess(1.0f, great);
        if (!(s > 1.0f && s <= 1.4f)) {  // success is not capped at 1, but the bonus is bounded by 0.4
            std::printf("FAIL success above 1: got %.6f\n", s);
            ++g_failures;
        }
        SuccessFactors awful;
        awful.boredom = 0.8f;
        awful.genrePopularity = 0.72f;
        awful.starRatings = 0.8f;
        Near("success never negative", ComputeSuccess(0.0f, awful), 0.0, 0.0);
        Near("out-of-range quality counts as 1.0", ComputeSuccess(1.5f, neutral), ComputeSuccess(1.0f, neutral), 0.0);
        Near("no boredom ingredients", BoredomFactor({}, {}).factor, 0.0, 0.0);
        Near("fresh ingredients", BoredomFactor({0.0f}, {0.0f}).factor, 1.0, 1e-6);
        Near("tech pioneer", TechPioneeringFactor(true), 1.1, 1e-6);
        Near("no tech pioneer", TechPioneeringFactor(false), 1.0, 0.0);
        Near("rating cuts success at 1", MovieStarRating(2.0f, 0.5f, false), 0.73 + 0.33 * 0.5, 1e-6);
        Near("rating of a perfect movie", MovieStarRating(1.0f, 0.9f, false), 1.0, 0.0);
    }

    // ---- Revenue payout ----
    {
        IncomeRecord inc = CreateAIIncome(0.5f, 0.0f, false);
        Near("pool at S = 0.5", inc.initialPool, 420000.0, 1e-3);
        Near("pool at S = 1.4", CreateAIIncome(1.4f, 0.0f, false).initialPool, 2814000.0, 1.0);
        Near("back catalogue has no pool", CreateAIIncome(0.5f, 0.3f, true).pool, 0.0, 0.0);
        const double rate0 = inc.dailyPercentage;
        const double paid = DailyPayout(inc, 0.0);
        Near("first payout without the random extra", paid, 420000.0 * rate0, 1e-6);
        Near("rate decays", inc.dailyPercentage, rate0 * inc.dailyMultiplier, 1e-12);
        // Pay out for years: everything is paid, never more than the pool.
        double total = paid;
        for (int day = 0; day < 5000; ++day) total += DailyPayout(inc, 0.5);
        Near("whole pool is paid out", total, 420000.0, 1e-6);
        Near("pool is empty", inc.pool, 0.0, 0.0);
        Near("no payout from an empty pool", DailyPayout(inc, 1.0), 0.0, 0.0);
        // The first-year share for an AI movie: about 87% of the pool is paid within the first year (docs 3j).
        IncomeRecord ai = CreateAIIncome(0.2812f, 0.2232f, false);
        double year = 0.0;
        for (int day = 0; day < 360; ++day) year += DailyPayout(ai, 0.5);
        Near("share paid in the first year", year / ai.initialPool, 0.87, 0.02);
    }

    // ---- Genre saturation ----
    {
        Near("nothing is recorded before 1930", SaturationPushAmount(1929.0), 0.0, 0.0);
        Near("nothing at 1930.0", SaturationPushAmount(1930.0), 0.0, 0.0);
        Near("ramp at 1935", SaturationPushAmount(1935.0), 0.15 * 0.5, 1e-6);
        Near("full size from 1940", SaturationPushAmount(1945.0), 0.15, 1e-6);
        Near("award weight", SaturationPushAmount(1945.0, 0.5f), 0.075, 1e-6);
        DecayValue sat{1945.0, 0.0, 2.0};
        sat.Add(0.15, 1945.0);
        Near("saturation after one release", sat.Clamped01(1945.0), 0.15, 1e-9);
        Near("halves in two years", sat.Clamped01(1947.0), 0.075, 1e-9);
        sat.Add(0.15, 1947.0);
        Near("a second release adds to the decayed value", sat.Clamped01(1947.0), 0.225, 1e-9);
        Near("never above 1", DecayValue{0.0, 5.0, 2.0}.Clamped01(0.0), 1.0, 0.0);
    }

    if (g_failures) {
        std::printf("%d check(s) failed\n", g_failures);
        return 1;
    }
    std::printf("all MovieSuccess checks passed\n");
    return 0;
}
