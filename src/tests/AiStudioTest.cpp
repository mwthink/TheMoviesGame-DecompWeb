// Checks the AI release decision against decade_log.csv rows from the running game (run5, tracer with the mean/rms hook):
// every row below is a call of CStudioAI_DecideAndReleaseMovie with the logged inputs and whether it released.
#include <cmath>
#include <cstdio>

#include "game/ai/AiStudio.hpp"

using namespace otm::ai;

static int g_failures = 0;

struct Row { double own, since, mean, rms; bool released; };

int main() {
    const Row rows[] = {
        // releases
        {0.0895, 1.162, -0.053283, 0.095463, true},  {0.0202, 1.334, -0.038565, 0.098500, true},
        {0.0110, 1.343, -0.038288, 0.099447, true},  {-0.0256, 1.460, -0.015474, 0.122380, true},
        {-0.0863, 1.513, -0.008225, 0.125422, true}, {-0.0983, 1.514, -0.008085, 0.125326, true},
        {-0.1581, 1.590, 0.012935, 0.114263, true},  {-0.1662, 1.592, 0.011879, 0.114837, true},
        {0.1414, 1.387, 0.031911, 0.085889, true},
        // the three highest-scoring decisions that did not release (scores 0.489, 0.483, 0.474)
        {0.0880, 1.141, -0.054414, 0.096662, false}, {-0.1445, 1.518, -0.007980, 0.125694, false},
        {-0.0299, 1.429, -0.012406, 0.122658, false},
    };
    for (const Row& r : rows) {
        const SuccessDifferenceStats st{r.mean, r.rms};
        const double score = ReleaseScore(ReleaseDesire(r.own, st), r.since);
        const bool ok = r.released ? (score >= 0.495 && score <= 0.52) : (score < 0.5 && score > 0.45);
        if (!ok) { std::printf("FAIL since %.3f own %.4f: score %.4f, released %d\n", r.since, r.own, score, r.released); ++g_failures; }
    }
    // The model itself, hand-computed: desire 0 / 1 limits and the ramp.
    const SuccessDifferenceStats flat{0.0, 0.0};
    if (ReleaseScore(0.6, 0.4) != 0.0) { std::printf("FAIL no release before the minimum gap\n"); ++g_failures; }
    if (std::fabs(ReleaseScore(0.6, 0.5 + 0.375) - 0.3) > 1e-12) { std::printf("FAIL ramp at a quarter\n"); ++g_failures; }
    if (std::fabs(ReleaseScore(0.6, 2.0) - 1.0) > 1e-12) { std::printf("FAIL score 1 at the maximum gap (2 years)\n"); ++g_failures; }
    if (ReleaseDesire(1.0, flat) != 1.0) { std::printf("FAIL desire clamp (0.3 + 2.4 -> 1)\n"); ++g_failures; }
    const SuccessDifferenceStats s = ComputeStats({0.1f, -0.1f, 0.3f});
    if (std::fabs(s.mean - 0.1) > 1e-6 || std::fabs(s.rms - std::sqrt(0.11 / 3.0)) > 1e-6) { std::printf("FAIL stats\n"); ++g_failures; }

    if (g_failures) { std::printf("%d failure(s)\n", g_failures); return 1; }
    std::printf("ai studio: all checks passed\n");
    return 0;
}
