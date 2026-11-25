// MovieQuality against the worked examples and the two measured movies in docs/MOVIE_QUALITY.md.
import { test } from "node:test";
import {
  averageCastPerformance, computeFinalQuality, computeQuality, crewFactor, diminishingBonus, genreExperienceFactor, normalizePerformance,
  preProductionWeight, productionFactors, setConditionFactor, starRelationshipFactor, type FinalQualityInput,
} from "../../src/sim/movie/MovieQuality.ts";
import { f32, near } from "./check.ts";

// the formula only sees the product of the four production factors
const withProduction = (script: number, production: number) => productionFactors({ scriptQuality: f32(script), castPerformance: f32(production) });

test("section 2 worked examples and the bonus cap", () => {
  near("all factors 1.0", computeQuality(withProduction(0.6, 1.0)), 0.568, 0.0005);
  near("P = 1.2", computeQuality(withProduction(0.6, 1.2)), 0.698, 0.0005);
  near("P = 0.8", computeQuality(withProduction(0.6, 0.8)), 0.408, 0.0005);
  near("P = 2.0", computeQuality(withProduction(0.6, 2.0)), 0.9275, 0.0001);
  near("bonus cap", diminishingBonus(100), 0.4, 0.0005);
  near("penalty is linear", diminishingBonus(-0.25), -0.25, 0);
  near("quality never above 1", computeQuality(withProduction(0.9, 5.0)), 1, 0);
  near("quality never below 0", computeQuality(withProduction(0.1, 0.1)), 0, 0);
});

test("factor mappings", () => {
  near("set condition, no set", setConditionFactor(1), 1, 1e-6);
  near("set condition, wrecked", setConditionFactor(0), 0.9, 1e-6);
  near("crew, no experience", crewFactor(0), 0.9, 1e-6);
  near("crew, expert", crewFactor(1), 1.1, 1e-6);
  near("relationship, neutral 0.5", starRelationshipFactor(0.5, 1), 1, 1e-6);
  near("relationship, friends", starRelationshipFactor(1, 1), 1.2, 1e-6);
  near("relationship, enemies", starRelationshipFactor(0, 1), 0.8, 1e-6);
  near("relationship, nobody counted", starRelationshipFactor(0, 0), 0.8, 1e-6);
  near("normalise performance low", normalizePerformance(0.5), 0, 0);
  near("normalise performance high", normalizePerformance(2), 1, 0);
  near("normalise performance mid", normalizePerformance(1.125), 0.5, 1e-6);
  near("genre, no skill", genreExperienceFactor(0, []), 0.8, 1e-6);
  near("genre, other genres capped", genreExperienceFactor(0.5, [1, 1]), (0.5 + 0.25) * 0.4 + 0.8, 1e-6);
  near("cast average with director", averageCastPerformance([1, f32(1.2)], f32(1.4)), 1.2, 1e-6);
  near("director only", averageCastPerformance([], f32(1.3)), 1.3, 1e-6);
});

test("pre-production weight table (section 7)", () => {
  near("weight 600", preProductionWeight(600), 0.49, 0.005);
  near("weight 1000", preProductionWeight(1000), 0.7, 0.005);
  near("weight 1500", preProductionWeight(1500), 0.87, 0.005);
  near("weight 2000", preProductionWeight(2000), 0.96, 0.005);
  near("weight 3000", preProductionWeight(3000), 1, 1e-6);
  near("weight beyond 3000", preProductionWeight(9000), 1, 1e-6);
});

const shots = (list: [number, number][]) => list.map(([weight, quality]) => ({ weight, quality: f32(quality) }));

// Measured: two player movies (1922), final quality logged by the running game.
const m1: FinalQualityInput = {
  hasPreProduction: true, ticksInPreProduction: 794, preProductionQuality: f32(0.23316),
  shots: shots([[15, 0.1759], [12, 0.16927], [36, 0.18699], [50, 0.19376]]),
};
const m2: FinalQualityInput = {
  hasPreProduction: true, ticksInPreProduction: 755, preProductionQuality: f32(0.23387),
  shots: shots([[89, 0.14685], [222, 0.19179], [23, 0.19655]]),
};

test("the final quality of two measured movies", () => {
  near("measured movie 1", computeFinalQuality(m1), 0.17509, 0.00001);
  near("measured movie 2", computeFinalQuality(m2), 0.16907, 0.00001);
});

test("structural properties (section 7)", () => {
  near("no pre-production: shots only", computeFinalQuality({ ...m1, hasPreProduction: false }), 0.75 * 0.186631, 0.0001);
  near("no shots: pre-production only", computeFinalQuality({ ...m1, shots: [] }), 0.035112, 0.00001);
  near("perfect movie", computeFinalQuality({ hasPreProduction: true, ticksInPreProduction: 3000, preProductionQuality: 1, shots: shots([[10, 1], [10, 1]]) }), 1, 1e-6);
});
