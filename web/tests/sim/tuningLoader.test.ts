// The movie tuning loader: small inline files (always), then the real data files from the game's archives (skipped without the game).
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsv } from "../../src/formats/Csv.ts";
import { Ini } from "../../src/formats/Ini.ts";
import { newReport } from "../../src/sim/core/Tuning.ts";
import { defaultActorTuning } from "../../src/sim/movie/ActorPerformance.ts";
import { defaultQualityTuning } from "../../src/sim/movie/MovieQuality.ts";
import { defaultSuccessTuning, genreTrend } from "../../src/sim/movie/MovieSuccess.ts";
import { buildMovieTuning, defaultAwardBonusTuning, emptySources, loadMovieTuning } from "../../src/sim/movie/TuningLoader.ts";
import { haveGame, pakIndex } from "../helpers.ts";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Every number in loaded equals the default (the defaults were copied from the docs; they must be what the installed game ships). */
export function expectSame(what: string, loaded: object, defaults: object): void {
  for (const [k, v] of Object.entries(defaults)) {
    const got = (loaded as Record<string, unknown>)[k];
    if (Array.isArray(v)) v.forEach((x, i) => assert.ok(close((got as number[])[i]!, x), `${what}.${k}[${i}]: ${(got as number[])[i]} in the game files, ${x} in the defaults`));
    else if (typeof v === "number") assert.ok(close(got as number, v), `${what}.${k}: ${got} in the game files, ${v} in the defaults`);
  }
}

test("inline sources", () => {
  const s = emptySources();
  s.releasingMovies = Ini.parse("[min_max]\n crew_min = 0.5\n crew_max = 1.5\n star_mood_min = 0.7\n[overall]\n quality_overall_max_adder = 0.9\n[income]\n revenue_base = 100\n");
  s.global = Ini.parse("[project]\n starratingboxoffice = 0.5\n[genre]\n boredomhalflife = 3\n");
  s.stunts = Ini.parse("healththreshold = 0.05\n[performance]\n likenessbonus = 1.3\n");
  s.awardsBonuses = Ini.parse("trendsetter_boost = 0.9\nupper_mood_val = 0.8\n");
  s.timeline = parseCsv(
    "[constants],,,,,,,,,\nhalflife,6,,,,,,,,\n\n" +
    "[timeline],year,technology,opinion_smoking,genre_action,genre_comedy,genre_horror,genre_romance,genre_sci-fi,month\n" +
    ",1900,,,,,,,,\ntimeline_B,1930.5,,,0,1,,,,6\ntimeline_A,1924.5,,,1,,,,,7\n");
  const report = newReport();
  const t = buildMovieTuning(s, report);
  assert.ok(close(t.quality.crewMin, 0.5) && close(t.quality.crewMax, 1.5));
  assert.ok(close(t.actor.starMoodMin, 0.7));
  assert.ok(close(t.quality.overallMaxAdder, 0.9));
  assert.equal(t.success.revenueBase, 100);
  assert.ok(close(t.success.starRatingBoxOffice, 0.5));
  assert.equal(t.success.genreBoredomHalfLife, 3);
  assert.ok(close(t.actor.healthThreshold, 0.05)); // from the part before the first [section]
  assert.ok(close(t.actor.likenessBonus, 1.3));
  assert.ok(close(t.bonuses.trendsetter, 0.9) && close(t.bonuses.upperMoodThreshold, 0.8));
  assert.equal(t.success.trendHalfLife, 6);
  // missing keys keep their defaults and are reported
  assert.equal(t.quality.setRepairMin, defaultQualityTuning().setRepairMin);
  assert.ok(report.problems.some((p) => p.includes("set_repair_value_min: missing")));
  // events: per genre, sorted by year, blank cells skipped
  const action = t.genreEvents.get("action")!;
  assert.equal(action.length, 2);
  assert.equal(action[0]!.year, 1924.5);
  assert.deepEqual(t.genreEvents.get("comedy"), [{ year: 1930.5, value: 1 }]);
  assert.ok(!t.genreEvents.has("horror") && !t.genreEvents.has("sci-fi"));
  // and they drive the trend with the loaded half-life
  assert.ok(close(genreTrend(action, 1924.5, t.success), 1));
  assert.ok(close(genreTrend(action, 1924.5 + 5, t.success), Math.fround(0.5 + 0.5 * Math.pow(2, -5 / 6))));
  assert.ok(close(genreTrend(action, 1930.5, t.success), 0)); // the later event replaces the earlier one
});

test("empty sources: every default kept, everything reported", () => {
  const report = newReport();
  const t = buildMovieTuning(emptySources(), report);
  expectSame("quality", t.quality, defaultQualityTuning());
  assert.ok(report.problems.length > 50);
});

test("the real data files", { skip: haveGame ? false : "needs the game archives (OTM_GAME_DIR)" }, async () => {
  const report = newReport();
  const t = await loadMovieTuning(await pakIndex(), report);
  assert.deepEqual(report.problems, []);
  expectSame("quality", t.quality, defaultQualityTuning());
  expectSame("success", t.success, defaultSuccessTuning());
  expectSame("actor", t.actor, defaultActorTuning());
  expectSame("bonuses", t.bonuses, defaultAwardBonusTuning());
  // Audience taste timeline: event counts per genre from docs/MOVIE_SUCCESS.md 3f, plus the far-future sentinel rows (2100.4 / 2150.4) that never trigger.
  const n = (g: string) => t.genreEvents.get(g)!.length;
  assert.deepEqual([n("action"), n("comedy"), n("horror"), n("romance"), n("sci-fi")], [14, 12, 10, 8, 15]);
  assert.ok(t.genreEvents.get("action")!.at(-1)!.year > 2100);
  // the logged trend: the action event of 1924.5 (value 1), 0.357 years later the trend was 0.9700
  assert.ok(Math.abs(genreTrend(t.genreEvents.get("action")!, 1924.857, t.success) - 0.97) < 1e-4);
  assert.ok(close(genreTrend(t.genreEvents.get("action")!, 1920, t.success), 0.5));
});
