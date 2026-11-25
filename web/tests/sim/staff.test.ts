// Traits, experience, stunts and the star rating against docs/TRAITS_AND_EXPERIENCE.md, docs/STUNT_SYSTEM.md and docs/STARS.md 3aa-3ac, then the
// staff tuning loader (inline, and the real files from the archives).
import assert from "node:assert/strict";
import { test } from "node:test";
import { Ini } from "../../src/formats/Ini.ts";
import { newReport } from "../../src/sim/core/Tuning.ts";
import { DecayValue } from "../../src/sim/movie/MovieSuccess.ts";
import { buildStaffTuning, defaultStaffBonusTuning, emptyStaffSources, loadStaffTuning } from "../../src/sim/staff/StaffTuningLoader.ts";
import { addFilmRating, awardsComponent, computeStarRating, defaultStarRatingTuning, entourageComponent, newRatingValue, ratingComponent, starComponents } from "../../src/sim/staff/StarRating.ts";
import {
  addStuntExperience, defaultStuntTuning, nextRandomUnit, rollStuntOutcome, stuntActorScore, stuntExperienceGain, stuntHealthLoss, stuntSuccessChance, stuntTrainingXp,
} from "../../src/sim/staff/Stunts.ts";
import { defaultExperienceTable, Experience, experience, genreExperienceGain, TraitMap } from "../../src/sim/staff/Traits.ts";
import { haveGame, pakIndex } from "../helpers.ts";
import { expectSame, f32, nearD as near } from "./check.ts";

test("traits (TRAITS_AND_EXPERIENCE.md section 1)", () => {
  const t = new TraitMap();
  assert.ok(!t.has("Stunts"));
  near("a missing trait reads as 0", t.get("Stunts"), 0, 0);
  t.set("Stunts", 1.5);
  near("set clamps to 0..1", t.get("Stunts"), 1, 0);
  t.set("Stunts", -0.2);
  near("set clamps below", t.get("Stunts"), 0, 0);
  // "a 0.026 lead-role gain moves a 0.5 skill by 0.013 and a 0.9 skill by 0.0026"
  t.set("comedy", 0.5);
  near("gain at 0.5", t.add("comedy", f32(0.026)), 0.013, 1e-6);
  near("after", t.get("comedy"), 0.513, 1e-6);
  t.set("action", f32(0.9));
  near("gain at 0.9", t.add("action", f32(0.026)), 0.0026, 1e-6);
  near("after", t.get("action"), 0.9026, 1e-6);
  const fresh = new TraitMap();
  near("a new trait starts at the gain", fresh.add("horror", f32(0.1)), 0.1, 1e-6);
  near("stored", fresh.get("horror"), 0.1, 1e-6);
  const boosted = new TraitMap();
  boosted.set("Movies", 0);
  near("the experience award bonus multiplies the gain", boosted.add("Movies", f32(0.1), f32(1.1)), 0.11, 1e-6);
  const capped = new TraitMap();
  capped.set("Stunts", f32(0.99));
  for (let i = 0; i < 100; i++) capped.add("Stunts", 0.5);
  assert.ok(capped.get("Stunts") <= 1 && capped.get("Stunts") > f32(0.999));
  const cs = new TraitMap();
  cs.set("Stunts", 0.5);
  assert.ok(!cs.has("stunts"), "names are case-sensitive");
});

test("experience table", () => {
  const e = defaultExperienceTable();
  near("lead role", experience(e, Experience.MoviesLeadRole), 0.026, 1e-7);
  near("stuntman", experience(e, Experience.MoviesStuntman), 0.013, 1e-7);
  near("600 is clamped to 1", experience(e, Experience.SetRehearseTime), 1, 0);
  e.values[0] = -0.5;
  near("negative gives 0", experience(e, Experience.LotPerHammerBuild), 0, 0);
  const d = defaultExperienceTable();
  near("director", genreExperienceGain("director", false, d), 0.026, 1e-7);
  near("lead", genreExperienceGain("lead", false, d), 0.026, 1e-7);
  near("support", genreExperienceGain("support", false, d), 0.013, 1e-7);
  near("other", genreExperienceGain("other", false, d), 0.013, 1e-7);
  near("a stuntman learns 70%", genreExperienceGain("lead", true, d), 0.7 * 0.026, 1e-7);
});

test("the stunt roll (STUNT_SYSTEM.md section 2)", () => {
  const t = defaultStuntTuning();
  near("equal to the difficulty: 80%", stuntSuccessChance(0.5, 0.5, false, t), 0.8, 1e-6);
  near("with a lucky charm 90%", stuntSuccessChance(0.5, 0.5, true, t), 0.9, 1e-6);
  near("0.5 below", stuntSuccessChance(0, 0.5, false, t), 0.2, 1e-6);
  near("1.0 below: clamped to 5%", stuntSuccessChance(0, 1, false, t), 0.05, 1e-6);
  near("0.5 above", stuntSuccessChance(1, 0.5, false, t), 0.95, 1e-6);
  near("0.8 above: capped at 98%", stuntSuccessChance(1, f32(0.2), false, t), 0.98, 1e-6);
  near("0.1 above gives 83%", stuntSuccessChance(0.5, f32(0.4), false, t), 0.83, 1e-6);
  near("0.1 below gives 68%", stuntSuccessChance(f32(0.4), 0.5, false, t), 0.68, 1e-6);
  near("lucky charm adds a flat 10 points", stuntSuccessChance(0.5, f32(0.6), true, t), 0.78, 1e-6);
  near("best skill, full health", stuntActorScore(1, 1, t), 1, 1e-6);
  near("no health: ability 0.5, injured x0.7", stuntActorScore(1, 0, t), 0.35, 1e-6);
  near("ability 0.5 + 0.5 * 0.5", stuntActorScore(f32(0.8), 0.5, t), 0.8 * 0.75, 1e-6);
  near("at the threshold: not injured", stuntActorScore(f32(0.8), f32(0.01), t), 0.8 * (0.5 + 0.5 * 0.01), 1e-6);
  near("no skill", stuntActorScore(0, 1, t), 0, 0);
  // the random generator (values computed independently from the constants)
  const rnd = { seed: 1 };
  near("draw 1", nextRandomUnit(rnd), 0.8916441983729, 1e-6);
  assert.equal(rnd.seed, 1015568748);
  near("draw 2", nextRandomUnit(rnd), 0.9541654231066999, 1e-6);
  near("draw 3", nextRandomUnit(rnd), 0.0339361458961, 1e-6);
  const seven = { seed: 7 };
  const none = rollStuntOutcome([], 0.5, false, seven, t);
  assert.ok(!none.rolled && !none.failed);
  assert.equal(seven.seed, 7, "the generator is not advanced");
  let r = rollStuntOutcome([0.5, 0.5], 0.5, false, { seed: 1 }, t); // chance 0.80, draw 0.8916 >= 0.80: failure
  assert.ok(r.rolled && r.failed);
  near("cast score", r.castScore, 0.5, 1e-6);
  near("chance", r.chance, 0.8, 1e-6);
  r = rollStuntOutcome([0.5], 0.5, true, { seed: 1 }, t); // chance 0.90, draw 0.8916 < 0.90: success
  assert.ok(r.rolled && !r.failed);
  near("the cast score is the mean of the performers", rollStuntOutcome([f32(0.2), f32(0.8)], 0.5, false, { seed: 1 }, t).castScore, 0.5, 1e-6);
  // over many rolls the success rate matches the chance
  for (const [score, difficulty, chance] of [[0, 0.5, 0.2], [0.5, 0.5, 0.8], [1, 0.5, 0.95]] as const) {
    const s = { seed: 20061 };
    let ok = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) ok += rollStuntOutcome([score], difficulty, false, s, t).failed ? 0 : 1;
    near(`success rate at chance ${chance}`, ok / n, chance, 0.005);
  }
});

test("injuries (STUNT_SYSTEM.md section 5)", () => {
  const t = defaultStuntTuning();
  near("skilled actor, easy stunt: about 0.10 even on failure", stuntHealthLoss(1, f32(0.1), true, t), 0.1, 1e-6);
  near("unskilled, hard: up to 0.80", stuntHealthLoss(0, 1, true, t), 0.8, 1e-6);
  near("success: 0.10 .. 0.20", stuntHealthLoss(0, 1, false, t), 0.2, 1e-6);
  near("no danger", stuntHealthLoss(0, 0, true, t), 0.1, 1e-6);
  near("skill reduces the danger by 0.3 * skill", stuntHealthLoss(0.5, f32(0.55), true, t), 0.1 + 0.7 * (0.55 - 0.15), 1e-6);
  assert.ok(stuntHealthLoss(f32(0.3), f32(0.9), true, t) > stuntHealthLoss(f32(0.3), 0.5, true, t), "harder is worse");
  assert.ok(stuntHealthLoss(f32(0.9), f32(0.9), true, t) < stuntHealthLoss(f32(0.1), f32(0.9), true, t), "skill helps");
});

test("stunt experience and training (STUNT_SYSTEM.md section 5)", () => {
  const t = defaultStuntTuning();
  near("stuntman, hardest, success", stuntExperienceGain(1, true, true, -1, t), 0.06, 1e-6);
  near("easiest success", stuntExperienceGain(0, true, true, -1, t), 0.02, 1e-6);
  near("hardest failure", stuntExperienceGain(1, false, true, -1, t), 0.04, 1e-6);
  near("easiest failure", stuntExperienceGain(0, false, true, -1, t), 0.01, 1e-6);
  near("an actor learns 70%", stuntExperienceGain(1, true, false, -1, t), 0.06 * 0.7, 1e-6);
  near("natural talent", stuntExperienceGain(1, true, false, f32(1.2), t), 0.06 * 1.2 * 0.7, 1e-6);
  assert.ok(stuntExperienceGain(0.5, true, true, -1, t) > stuntExperienceGain(0.5, false, true, -1, t));
  const traits = new TraitMap();
  traits.set("Stunts", 0.5);
  near("gain", addStuntExperience(traits, 1, true, true, -1, 1, t), 0.5 * 0.06, 1e-6);
  near("Stunts after", traits.get("Stunts"), 0.53, 1e-6);
  near("perfect match: top of the range", stuntTrainingXp(0.5, 0.5, true, 1, -1, t), 0.04, 1e-6);
  near("no match: raised to the minimum", stuntTrainingXp(1, 0, true, 1, -1, t), 0.005, 1e-6);
  near("the failure range is smaller", stuntTrainingXp(0.5, 0.5, false, 1, -1, t), 0.03, 1e-6);
  near("injured: x0.1", stuntTrainingXp(0.5, 0.5, true, 0, -1, t), 0.004, 1e-6);
  near("natural talent", stuntTrainingXp(0.5, 0.5, true, 1, f32(1.2), t), 0.048, 1e-6);
  near("half match: 0.0, raised to the minimum", stuntTrainingXp(0.5, 0, true, 1, -1, t), 0.005, 1e-6);
});

test("the star rating (STARS.md 3aa-3ac)", () => {
  const t = defaultStarRatingTuning();
  near("nothing", computeStarRating(starComponents(), 0, t), 0, 0);
  const all = starComponents({ movies: 1, salary: 1, performance: 1, image: 1, entourage: 1, trailer: 1, pressBar: 1, relationships: 1, awards: 1 });
  near("the weights add up to 1.006: capped at 1", computeStarRating(all, 0, t), 1, 0);
  const movies = starComponents({ movies: 1 });
  near("movies only", computeStarRating(movies, 0, t), 0.174, 1e-6);
  near("mixed", computeStarRating(starComponents({ movies: 0.5, salary: 1, entourage: 0.5 }), 0, t), 0.174 * 0.5 + 0.139 + 0.104 * 0.5, 1e-6);
  near("the base term is added and clamped", computeStarRating(movies, f32(0.2), t), 0.374, 1e-6);
  near("all plus base", computeStarRating(all, 0.5, t), 1, 0);
  near("components are clamped to 0..1 first", computeStarRating(starComponents({ movies: 5 }), 0, t), 0.174, 1e-6);
  near("entourage 0", entourageComponent(0, t), 0, 0);
  near("entourage 3", entourageComponent(3, t), 0.5, 1e-6);
  near("entourage 6", entourageComponent(6, t), 1, 1e-6);
  near("six members give the full value", entourageComponent(9, t), 1, 0);
  near("one award", awardsComponent(1, t), 0.5263158, 1e-6);
  near("two awards cap it", awardsComponent(2, t), 1, 0);
  // films feed the movies component (3ac): S = 0.8 gains 0.32, a flop S = 0.3 only 0.12
  const v = newRatingValue(t);
  addFilmRating(v, f32(0.8), 1930, t);
  near("after one film", ratingComponent(v, 1930), 0.32, 1e-6);
  near("halves after ten years", ratingComponent(v, 1940), 0.16, 1e-6);
  addFilmRating(v, f32(0.8), 1932, t); // "two such films within a few years push it near 0.6"
  near("two films", ratingComponent(v, 1932), 0.32 * Math.pow(2, -0.2) + 0.32, 1e-5);
  assert.ok(ratingComponent(v, 1932) > 0.55 && ratingComponent(v, 1932) < 0.65);
  addFilmRating(v, f32(0.8), 1934, t); // "three near 0.9"
  assert.ok(ratingComponent(v, 1934) > 0.8 && ratingComponent(v, 1934) < 0.9);
  const flop: DecayValue = newRatingValue(t);
  addFilmRating(flop, f32(0.3), 1930, t);
  near("a flop", ratingComponent(flop, 1930), 0.12, 1e-6);
  addFilmRating(flop, 3, 1930, t);
  near("success above 1 counts as 1: 0.4", ratingComponent(flop, 1930), 0.12 + 0.4, 1e-6);
});

test("staff tuning loader, inline sources", () => {
  const s = emptyStaffSources();
  s.experience = Ini.parse("MOVIES_LEADROLE = 0.05\nSTARS_EXPERIENCE_DECAY = 0.01\n");
  s.stunts = Ini.parse("healththreshold = 0.1\n[successfailure]\nstuntchancemax = 0.9\n[training]\nlowhealthmultiplier = 0.2\n");
  s.global = Ini.parse("[star]\nratingshalflife = 5\nstarratingweightmovies = 0.3\n");
  s.awardsBonuses = Ini.parse("natural_talent_factor = 1.5\n");
  const report = newReport();
  const t = buildStaffTuning(s, report);
  near("lead role", experience(t.experience, Experience.MoviesLeadRole), 0.05, 1e-7);
  near("key names are case-insensitive", t.experience.starsExperienceDecay, 0.01, 1e-7);
  near("health threshold", t.stunts.healthThreshold, 0.1, 1e-7);
  near("chance max", t.stunts.chanceMax, 0.9, 1e-7);
  near("low health multiplier", t.stunts.trainingLowHealthMultiplier, 0.2, 1e-7);
  near("ratings half-life", t.starRating.ratingsHalfLife, 5, 1e-7);
  near("movies weight", t.starRating.weightMovies, 0.3, 1e-7);
  near("natural talent", t.bonuses.naturalTalent, 1.5, 1e-7);
  near("missing keys keep their defaults", t.stunts.chanceLow, defaultStuntTuning().chanceLow, 0);
  assert.ok(report.problems.length > 0, "and are reported");
});

test("staff tuning loader, the real data files", { skip: haveGame ? false : "needs the game archives (OTM_GAME_DIR)" }, async () => {
  const report = newReport();
  const t = await loadStaffTuning(await pakIndex(), report);
  assert.deepEqual(report.problems, []);
  expectSame("experience", t.experience, defaultExperienceTable());
  expectSame("stunts", t.stunts, defaultStuntTuning());
  expectSame("starRating", t.starRating, defaultStarRatingTuning());
  expectSame("bonuses", t.bonuses, defaultStaffBonusTuning());
});
