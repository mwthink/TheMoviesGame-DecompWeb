// The AI studio's release decision: when a computer-controlled studio makes a movie.
//
// Reimplemented from CStudioAI_DecideAndReleaseMovie (0x5154A0), with the mean and RMS taken from
// CStudioAI_MeanSuccessDifference (0x5148D0) and CStudioAI_RmsSuccessDifference (0x514950). Derivation: docs/MOVIE_SUCCESS.md
// section 3m. Tuning: Data/rule/aistudios.csv.
#pragma once

#include <vector>

namespace otm::ai {

// Data/rule/aistudios.csv, the rows the decision reads.
struct AiRules {
    float differenceTarget = 0.1f;      // "Difference target"
    float differenceMultiplier = 3.0f;  // "Difference multiplier"
    float deviationTarget = 0.2f;       // "Deviation target"
    float deviationMultiplier = 12.0f;  // "Deviation multiplier"
    float minYearsBetweenReleases = 0.5f;  // "Minimum time between releases" (182.5 days)
    float maxYearsBetweenReleases = 2.0f;  // "Maximum time between releases" (730 days)
    float releaseThreshold = 0.5f;      // "Movie release desire threshold"
};

// The mean and the root mean square of every AI studio's success difference (+0x298), over all studios in the studio list
// (including ones that never get to decide).
struct SuccessDifferenceStats {
    double mean = 0.0;
    double rms = 0.0;
};
// orig: 0x005148D0 0x00514950
SuccessDifferenceStats ComputeStats(const std::vector<float>& successDifferences);

// "Desire": how much the studio group is away from the target spread, scaled by this studio's own difference, clamped to 0..1.
//   clamp01((differenceTarget - mean) * differenceMultiplier + (deviationTarget - rms) * deviationMultiplier * ownDifference)
double ReleaseDesire(double ownDifference, const SuccessDifferenceStats& stats, const AiRules& r = {});

// The release score: 0 until minYearsBetweenReleases after the last release, then desire ramps in linearly over half of
// (max - min) years, then rises from desire to 1 over the other half. yearsSinceLastRelease is the game clock minus the
// studio's last release time.
double ReleaseScore(double desire, double yearsSinceLastRelease, const AiRules& r = {});

// A studio releases a movie when the score is above the threshold.
// orig: 0x005154A0 verified (run5, 2026-11-21: 9 releases scored 0.499-0.512, the highest of 200 decisions without a release
// 0.489, against the 0.5 threshold, using the game's own mean/rms; one release is 0.001 below the threshold, within the
// precision of the logged time)
bool ShouldRelease(double ownDifference, const SuccessDifferenceStats& stats, double yearsSinceLastRelease,
                   const AiRules& r = {});

}  // namespace otm::ai
