// Tests for the movie estimate: the chain of quality, success and revenue, and the marketing comparison table of
// docs/MOVIE_SUCCESS.md section 3w (an end-to-end check of ComputeSuccess, the public-interest functions and the income model).
#include <cmath>
#include <cstdio>

#include "game/movie/MovieEstimate.hpp"

using namespace otm::movie;

static int g_failures = 0;

#define NEAR(a, b, tol)                                                                                        \
    do {                                                                                                       \
        const double va_ = (a), vb_ = (b);                                                                     \
        if (!(std::fabs(va_ - vb_) <= (tol))) {                                                                \
            std::printf("FAIL line %d: %s = %.6f, want %.6f (+-%g)\n", __LINE__, #a, va_, vb_, (double)(tol)); \
            ++g_failures;                                                                                      \
        }                                                                                                      \
    } while (0)

#define CHECK(cond)                                             \
    do {                                                        \
        if (!(cond)) {                                          \
            std::printf("FAIL line %d: %s\n", __LINE__, #cond); \
            ++g_failures;                                       \
        }                                                       \
    } while (0)

int main() {
    // ---- the quality chain: everything neutral, script 0.6 ----
    {
        EstimateInput in;
        in.marketingLevel = 1;
        const EstimateResult r = EstimateMovie(in);
        NEAR(r.shotQuality, 0.568, 0.0005);       // docs/MOVIE_QUALITY.md section 2: all factors 1.0, 3-star script
        NEAR(r.finalQuality, 0.568, 0.0005);      // full pre-production weight and identical shots: the same
        NEAR(r.factors.publicInterest, 1.0, 1e-6);  // no PR, no marketing
        NEAR(r.cappedHype, 0.0, 0.0);
        NEAR(r.marketingCost, 0.0, 0.0);
        CHECK(r.boxOffice > 70000.0);
        NEAR(r.netBoxOffice, r.boxOffice, 0.0);
        // the pool follows the revenue formula
        NEAR(r.boxOffice, 1400000.0 * r.success * r.success + 70000.0, 1.0);
        // the first-year share: about 81% of the pool with no public interest (the doc measured about 87% for an AI movie whose
        // hype gave a higher payout rate)
        CHECK(r.firstYearShare > 0.75 && r.firstYearShare < 0.87);
    }
    {
        // no pre-production time: the movie can never exceed 75% of the shot quality (docs/MOVIE_QUALITY.md section 7)
        EstimateInput in;
        in.preProductionTicks = 0;
        const EstimateResult r = EstimateMovie(in);
        NEAR(r.finalQuality, 0.75 * r.shotQuality, 1e-5);
        // better ingredients give a better movie
        EstimateInput good = in;
        good.castPerformance = 1.2f;
        good.crewMoviesTrait = 1.0f;
        good.chemistry = 0.9f;
        CHECK(EstimateMovie(good).shotQuality > r.shotQuality);
        // a movie without stars gets the worst relationship factor
        EstimateInput lonely = in;
        lonely.hasStars = false;
        CHECK(EstimateMovie(lonely).shotQuality < r.shotQuality);
        // marketing level changes only the market side, never the quality
        EstimateInput hi = in;
        hi.marketingLevel = 3;
        hi.hype = 0.2f;
        NEAR(EstimateMovie(hi).finalQuality, r.finalQuality, 0.0);
    }

    // ---- marketing table of docs/MOVIE_SUCCESS.md 3w ----
    // "typical film (TP 1.1, SR 0.94, GP 1.07, BO 0.93)", gain = pool increase minus cost, relative to level 1
    struct Row {
        float qm, hc;
        double gain[4];  // levels 2..5, in thousands of dollars
    };
    const Row rows[] = {
        {0.62f, 0.31f, {100, 148, 77, -3}},
        {0.62f, 0.20f, {134, 169, 109, 32}},
        {0.62f, 0.10f, {113, 166, 137, 67}},
        {0.75f, 0.375f, {90, 162, 145, 70}},
        {0.75f, 0.15f, {130, 182, 201, 136}},
        {0.50f, 0.25f, {114, 91, 19, -67}},
    };
    for (const Row& row : rows) {
        EstimateInput in;
        in.qualityOverride = row.qm;
        in.hype = row.hc;                       // below Qm / 2, so it is counted in full
        in.techPioneer = true;                  // TP 1.1
        in.genreTrend = (1.07f - 0.9f) / 0.3f;  // GP 1.07 with no saturation
        in.setBoredom = {0.35f};                // BO 0.93: (1 - 0.35) * 0.2 + 0.8
        // a single star rated so that SR = 0.94: SR = 0.8 + 0.4 * (0.7 * r) / (3 Qm - 0.3)
        in.starRatings = {static_cast<float>(0.35 * (3.0 * row.qm - 0.3) / 0.7)};
        in.symmetricImbalance = true;           // the table was computed with the symmetric reading
        const auto levels = CompareMarketingLevels(in);
        NEAR(levels[0].factors.starRatings, 0.94, 1e-4);
        NEAR(levels[0].factors.genrePopularity, 1.07, 1e-4);
        NEAR(levels[0].factors.boredom, 0.93, 1e-4);
        for (int lvl = 2; lvl <= 5; ++lvl) {
            const double gain = (levels[lvl - 1].boxOffice - levels[0].boxOffice - levels[lvl - 1].marketingCost) / 1000.0;
            NEAR(gain, row.gain[lvl - 2], 1.5);
        }
    }
    {
        // "level 3 is the best choice for most films, level 5 never best" (Qm 0.62, hype cap 0.31)
        EstimateInput in;
        in.qualityOverride = 0.62f;
        in.hype = 0.31f;
        in.techPioneer = true;
        in.symmetricImbalance = true;
        const auto levels = CompareMarketingLevels(in);
        int best = 0;
        for (int i = 0; i < 5; ++i) {
            if (levels[i].netBoxOffice > levels[best].netBoxOffice) best = i;
        }
        CHECK(best == 2);
    }
    {
        // The code's imbalance term is one-sided: with hype above D (no marketing, high hype) the baseline is better than the
        // symmetric reading says, so marketing looks less valuable. Only the hype > D side differs.
        EstimateInput code;
        code.qualityOverride = 0.62f;
        code.hype = 0.31f;
        code.marketingLevel = 1;
        EstimateInput sym = code;
        sym.symmetricImbalance = true;
        CHECK(EstimateMovie(code).boxOffice > EstimateMovie(sym).boxOffice);
        // with D above hype (level 5) both agree
        code.marketingLevel = sym.marketingLevel = 5;
        NEAR(EstimateMovie(code).boxOffice, EstimateMovie(sym).boxOffice, 1e-3);
    }

    // ---- logged releases (docs/MOVIE_SUCCESS.md 3u / 3v): PR releases through the whole chain ----
    {
        EstimateInput in;
        in.qualityOverride = 0.6208f;
        in.hype = 0.3104f;
        in.marketingLevel = 5;
        const EstimateResult r = EstimateMovie(in);
        NEAR(r.marketingD, 0.6896, 1e-4);
        NEAR(r.factors.publicInterest, 1.3352, 1e-4);  // logged PI
    }

    if (g_failures) {
        std::printf("%d check(s) failed\n", g_failures);
        return 1;
    }
    std::printf("all MovieEstimate checks passed\n");
    return 0;
}
