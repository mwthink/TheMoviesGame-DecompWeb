// Checks MovieQuality against the worked examples and the two measured movies in docs/MOVIE_QUALITY.md.
// No test framework: plain asserts, exit code 1 on the first failure summary.
#include <cmath>
#include <cstdio>

#include "game/movie/MovieQuality.hpp"

using namespace otm::movie;

static int g_failures = 0;

static void Near(const char* what, float got, float want, float tol) {
    if (!(std::fabs(got - want) <= tol)) {
        std::printf("FAIL %s: got %.6f, want %.6f (+-%g)\n", what, got, want, tol);
        ++g_failures;
    }
}

static ProductionFactors WithProduction(float script, float production) {
    ProductionFactors f;
    f.scriptQuality = script;
    f.castPerformance = production;  // the formula only sees the product of the four production factors
    return f;
}

int main() {
    // Section 2 worked examples, script quality 0.6 (3 stars).
    Near("all factors 1.0", ComputeQuality(WithProduction(0.6f, 1.0f)), 0.568f, 0.0005f);
    Near("P = 1.2", ComputeQuality(WithProduction(0.6f, 1.2f)), 0.698f, 0.0005f);
    Near("P = 0.8", ComputeQuality(WithProduction(0.6f, 0.8f)), 0.408f, 0.0005f);
    Near("P = 2.0", ComputeQuality(WithProduction(0.6f, 2.0f)), 0.9275f, 0.0001f);
    // The bonus is bounded by 0.4 however large the production factors are.
    Near("bonus cap", DiminishingBonus(100.0f), 0.4f, 0.0005f);
    Near("penalty is linear", DiminishingBonus(-0.25f), -0.25f, 0.0f);
    Near("quality never above 1", ComputeQuality(WithProduction(0.9f, 5.0f)), 1.0f, 0.0f);
    Near("quality never below 0", ComputeQuality(WithProduction(0.1f, 0.1f)), 0.0f, 0.0f);

    // Factor mappings.
    Near("set condition, no set", SetConditionFactor(1.0f), 1.0f, 1e-6f);
    Near("set condition, wrecked", SetConditionFactor(0.0f), 0.9f, 1e-6f);
    Near("crew, no experience", CrewFactor(0.0f), 0.9f, 1e-6f);
    Near("crew, expert", CrewFactor(1.0f), 1.1f, 1e-6f);
    Near("relationship, neutral 0.5", StarRelationshipFactor(0.5f, 1), 1.0f, 1e-6f);
    Near("relationship, friends", StarRelationshipFactor(1.0f, 1), 1.2f, 1e-6f);
    Near("relationship, enemies", StarRelationshipFactor(0.0f, 1), 0.8f, 1e-6f);
    Near("relationship, nobody counted", StarRelationshipFactor(0.0f, 0), 0.8f, 1e-6f);
    Near("normalise performance low", NormalizePerformance(0.5f), 0.0f, 0.0f);
    Near("normalise performance high", NormalizePerformance(2.0f), 1.0f, 0.0f);
    Near("normalise performance mid", NormalizePerformance(1.125f), 0.5f, 1e-6f);
    Near("genre, no skill", GenreExperienceFactor(0.0f, {}), 0.8f, 1e-6f);
    Near("genre, other genres capped", GenreExperienceFactor(0.5f, {1.0f, 1.0f}), (0.5f + 0.25f) * 0.4f + 0.8f, 1e-6f);
    Near("cast average with director", AverageCastPerformance({1.0f, 1.2f}, 1.4f), 1.2f, 1e-6f);
    Near("director only", AverageCastPerformance({}, 1.3f), 1.3f, 1e-6f);

    // Pre-production weight table from section 7.
    Near("weight 600", PreProductionWeight(600), 0.49f, 0.005f);
    Near("weight 1000", PreProductionWeight(1000), 0.70f, 0.005f);
    Near("weight 1500", PreProductionWeight(1500), 0.87f, 0.005f);
    Near("weight 2000", PreProductionWeight(2000), 0.96f, 0.005f);
    Near("weight 3000", PreProductionWeight(3000), 1.0f, 1e-6f);
    Near("weight beyond 3000", PreProductionWeight(9000), 1.0f, 1e-6f);

    // Measured: two player movies (1922), final quality logged by the running game.
    FinalQualityInput m1;
    m1.hasPreProduction = true;
    m1.ticksInPreProduction = 794;
    m1.preProductionQuality = 0.23316f;
    m1.shots = {{15, 0.17590f}, {12, 0.16927f}, {36, 0.18699f}, {50, 0.19376f}};
    Near("measured movie 1", ComputeFinalQuality(m1), 0.17509f, 0.00001f);

    FinalQualityInput m2;
    m2.hasPreProduction = true;
    m2.ticksInPreProduction = 755;
    m2.preProductionQuality = 0.23387f;
    m2.shots = {{89, 0.14685f}, {222, 0.19179f}, {23, 0.19655f}};
    Near("measured movie 2", ComputeFinalQuality(m2), 0.16907f, 0.00001f);

    // Structural properties from section 7.
    FinalQualityInput noPre = m1;
    noPre.hasPreProduction = false;
    Near("no pre-production: shots only", ComputeFinalQuality(noPre), 0.75f * 0.186631f, 0.0001f);
    FinalQualityInput noShots = m1;
    noShots.shots.clear();
    Near("no shots: pre-production only", ComputeFinalQuality(noShots), 0.035112f, 0.00001f);
    FinalQualityInput perfect;
    perfect.hasPreProduction = true;
    perfect.ticksInPreProduction = 3000;
    perfect.preProductionQuality = 1.0f;
    perfect.shots = {{10, 1.0f}, {10, 1.0f}};
    Near("perfect movie", ComputeFinalQuality(perfect), 1.0f, 1e-6f);

    if (g_failures) {
        std::printf("%d check(s) failed\n", g_failures);
        return 1;
    }
    std::printf("all MovieQuality checks passed\n");
    return 0;
}
