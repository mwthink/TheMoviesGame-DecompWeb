#include "game/ai/AiStudio.hpp"

#include <algorithm>
#include <cmath>

namespace otm::ai {

SuccessDifferenceStats ComputeStats(const std::vector<float>& d) {
    SuccessDifferenceStats s;
    if (d.empty()) return s;
    double sum = 0.0, sq = 0.0;
    for (float v : d) { sum += v; sq += double(v) * v; }
    s.mean = sum / d.size();
    s.rms = std::sqrt(sq / d.size());
    return s;
}

double ReleaseDesire(double own, const SuccessDifferenceStats& st, const AiRules& r) {
    const double v = (r.differenceTarget - st.mean) * r.differenceMultiplier +
                     (r.deviationTarget - st.rms) * r.deviationMultiplier * own;
    return std::clamp(v, 0.0, 1.0);
}

double ReleaseScore(double desire, double yearsSinceLast, const AiRules& r) {
    const double elapsed = yearsSinceLast - r.minYearsBetweenReleases;
    const double half = (r.maxYearsBetweenReleases - r.minYearsBetweenReleases) * 0.5;
    if (elapsed < 0.0) return 0.0;
    if (half <= 0.0) return desire;
    if (elapsed < half) return desire * elapsed / half;
    return desire + (1.0 - desire) * (elapsed - half) / half;
}

bool ShouldRelease(double own, const SuccessDifferenceStats& st, double yearsSinceLast, const AiRules& r) {
    return ReleaseScore(ReleaseDesire(own, st, r), yearsSinceLast, r) > r.releaseThreshold;
}

}  // namespace otm::ai
