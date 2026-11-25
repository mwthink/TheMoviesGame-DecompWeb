// The studio rating against logged STUDIO_COMPONENTS rows, and the AI release decision against logged CStudioAI_DecideAndReleaseMovie calls
// (decade_log.csv of two runs; the rows are fixtures).
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeStats, releaseDesire, releaseScore } from "../../src/sim/ai/AiStudio.ts";
import { computeStudioRating, decayedReputation } from "../../src/sim/studio/StudioRating.ts";
import { f32, nearD as near } from "./check.ts";

test("the studio rating: logged rows (appearance, decayed reputation, money, star power, awards, rating)", () => {
  const rows = [
    [1.0, 0.1244, 0.911, 0.4104, 0.678, 0.5872], [0.577, 0.4401, 1.0, 0.3836, 0.1695, 0.5434], [0.6733, 0.5043, 1.0, 0.4729, 0.0, 0.5695],
    [0.4027, 0.4872, 0.8704, 0.2176, 0.1695, 0.4589], [0.9447, 0.4412, 0.9518, 0.4848, 0.339, 0.6337], [1.0, 0.1201, 0.9033, 0.4066, 0.678, 0.5834],
    [0.5195, 0.4822, 1.0, 0.2397, 0.0, 0.4864], [0.9223, 0.5796, 1.0, 0.5012, 0.339, 0.679],
  ].map((r) => r.map(f32));
  for (const [appearance, reputation, money, starPower, awards, rating] of rows) {
    near("studio rating", computeStudioRating({ appearance: appearance!, reputation: reputation!, money: money!, starPower: starPower!, awards: awards! }), rating!, 1.5e-3);
  }
  // the player's studio at its first quarter: stored reputation 0.1717 in 1957.764, now 1960.0916
  near("decayed reputation (player)", decayedReputation(f32(0.1717), 1960.0916 - 1957.764), 0.1244, 2e-4);
  // an AI studio: base 0.4458 stored 1960.0, now 1960.0916 (logged 0.4401)
  near("decayed reputation (AI)", decayedReputation(f32(0.4458), 0.0916), 0.4401, 2e-4);
  // every term maxed adds to 1.005 and is capped at 1; nothing is below 0
  near("clamped at 1", computeStudioRating({ appearance: 1, reputation: 1, money: 1, starPower: 1, awards: 1 }), 1, 0);
  near("empty studio", computeStudioRating({ appearance: 0, reputation: 0, money: 0, starPower: 0, awards: 0 }), 0, 0);
});

test("the AI release decision: logged calls (own difference, years since the last release, mean, rms, released)", () => {
  const rows: [number, number, number, number, boolean][] = [
    // releases
    [0.0895, 1.162, -0.053283, 0.095463, true], [0.0202, 1.334, -0.038565, 0.0985, true], [0.011, 1.343, -0.038288, 0.099447, true],
    [-0.0256, 1.46, -0.015474, 0.12238, true], [-0.0863, 1.513, -0.008225, 0.125422, true], [-0.0983, 1.514, -0.008085, 0.125326, true],
    [-0.1581, 1.59, 0.012935, 0.114263, true], [-0.1662, 1.592, 0.011879, 0.114837, true], [0.1414, 1.387, 0.031911, 0.085889, true],
    // the three highest-scoring decisions that did not release (0.489, 0.483, 0.474)
    [0.088, 1.141, -0.054414, 0.096662, false], [-0.1445, 1.518, -0.00798, 0.125694, false], [-0.0299, 1.429, -0.012406, 0.122658, false],
  ];
  for (const [own, since, mean, rms, released] of rows) {
    const score = releaseScore(releaseDesire(own, { mean, rms }), since);
    assert.ok(released ? score >= 0.495 && score <= 0.52 : score < 0.5 && score > 0.45, `since ${since} own ${own}: score ${score}, released ${released}`);
  }
  // the model itself, hand-computed: the desire limits and the ramp
  assert.equal(releaseScore(0.6, 0.4), 0, "no release before the minimum gap");
  near("ramp at a quarter", releaseScore(0.6, 0.5 + 0.375), 0.3, 1e-12);
  near("score 1 at the maximum gap (2 years)", releaseScore(0.6, 2), 1, 1e-12);
  assert.equal(releaseDesire(1, { mean: 0, rms: 0 }), 1, "desire clamp (0.3 + 2.4 -> 1)");
  const s = computeStats([f32(0.1), f32(-0.1), f32(0.3)]);
  near("mean", s.mean, 0.1, 1e-6);
  near("rms", s.rms, Math.sqrt(0.11 / 3), 1e-6);
});
