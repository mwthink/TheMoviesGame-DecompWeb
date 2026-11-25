// The movie quality / success / performance tuning from the game's own data files, so the tuning objects hold the installed game's values instead of
// the defaults copied from the docs.
//
// Sources (all in the archives):
//   releasing_movies.ini  [min_max] [overall] [boredom] [pre_production] [star_mood_step] [genre_fit] [public_interest] [tech] [income]
//   global.ini            [project] (star rating weights), [genre] (saturation boost and half-life)
//   stunts.ini            likeness weights and health threshold (before the first section), [performance]
//   awardsbonuses.ini     award bonus values (before the first section)
//   misc_costs.ini        [project] marketing_spend_* (what each marketing level costs)
//   timeline.csv          [constants] halflife and the dated genre events of the audience taste
// A missing or unreadable value keeps the default and is listed in the report; the loader never fails.
import type { PakIndex } from "../../assets/Pak.ts";
import { parseCsv, type CsvRow } from "../../formats/Csv.ts";
import { Ini, parseNumber } from "../../formats/Ini.ts";
import { newReport, readDataText, readFloat, type LoadReport } from "../core/Tuning.ts";
import { defaultActorTuning, type ActorTuning } from "./ActorPerformance.ts";
import { defaultQualityTuning, type QualityTuning } from "./MovieQuality.ts";
import { defaultSuccessTuning, type SuccessTuning, type TasteEvent } from "./MovieSuccess.ts";

const f32 = Math.fround;

/**
 * Award bonus values (awardsbonuses.ini) the movie formulas use. The keys are matched to the bonuses by name (docs/AWARDS.md 3k-6); Trendsetter and
 * On The Radar are confirmed by logged values, the others by name only.
 */
export interface AwardBonusTuning {
  /** public_awareness_boost: On The Radar doubles PR */
  publicAwarenessBoost: number;
  /** trendsetter_boost: replaces the genre trend (genrePopularity's trendOverride) */
  trendsetter: number;
  /** genre_fit_boost: multiplies the genre-fit score (genreFitScore) */
  perfectFit: number;
  /** boredom_factor: multiplies set boredom (boredomFactor's input) */
  brainwasher: number;
  /** lower_mood_val: Easy To Please (moodPerformanceFactor) */
  lowerMoodThreshold: number;
  /** upper_mood_val */
  upperMoodThreshold: number;
}

export function defaultAwardBonusTuning(): AwardBonusTuning {
  return { publicAwarenessBoost: f32(2), trendsetter: f32(1), perfectFit: f32(2), brainwasher: f32(0.5), lowerMoodThreshold: f32(0.15), upperMoodThreshold: f32(0.75) };
}

export interface MovieTuning {
  quality: QualityTuning;
  success: SuccessTuning;
  actor: ActorTuning;
  bonuses: AwardBonusTuning;
  /** Audience taste events per genre (lower-case name without the "genre_" prefix), sorted by year; for genreTrend. */
  genreEvents: Map<string, TasteEvent[]>;
}

export interface TuningSources {
  releasingMovies: Ini;
  global: Ini;
  stunts: Ini;
  awardsBonuses: Ini;
  miscCosts: Ini;
  timeline: CsvRow[];
}

export function emptySources(): TuningSources {
  const e = Ini.parse("");
  return { releasingMovies: e, global: e, stunts: e, awardsBonuses: e, miscCosts: e, timeline: [] };
}

/** The dated genre events of timeline.csv, by genre. */
export function parseGenreEvents(timeline: readonly CsvRow[]): Map<string, TasteEvent[]> {
  const events = new Map<string, TasteEvent[]>();
  const header = timeline.findIndex((r) => r.length > 0 && r[0]!.trim().toLowerCase() === "[timeline]");
  if (header < 0) return events;
  const names = timeline[header]!.map((n) => n.trim().toLowerCase());
  const yearColumn = names.indexOf("year");
  if (yearColumn < 0) return events;
  const genres = names.flatMap((n, c) => (n.startsWith("genre_") ? [[c, n.slice(6)] as const] : []));
  for (const row of timeline.slice(header + 1)) {
    const year = parseNumber(row[yearColumn]);
    if (year === undefined) continue;
    for (const [c, g] of genres) {
      const value = parseNumber(row[c]);
      if (value === undefined) continue; // blank = no effect on that genre
      let list = events.get(g);
      if (!list) events.set(g, (list = []));
      list.push({ year, value: f32(value) });
    }
  }
  for (const list of events.values()) list.sort((a, b) => a.year - b.year); // stable
  return events;
}

/** Builds the tuning from already-parsed sources (no file access). */
export function buildMovieTuning(s: TuningSources, report: LoadReport = newReport()): MovieTuning {
  const t: MovieTuning = {
    quality: defaultQualityTuning(), success: defaultSuccessTuning(), actor: defaultActorTuning(), bonuses: defaultAwardBonusTuning(), genreEvents: new Map(),
  };
  const RM = "releasing_movies.ini";
  const rm = (section: string, key: string, target: object, field: string) => readFloat(s.releasingMovies, RM, section, key, target, field as never, report);

  const q = t.quality;
  rm("min_max", "unspread_performance_min", q, "unspreadPerformanceMin");
  rm("min_max", "unspread_performance_max", q, "unspreadPerformanceMax");
  rm("min_max", "set_repair_value_min", q, "setRepairMin");
  rm("min_max", "set_repair_value_max", q, "setRepairMax");
  rm("min_max", "star_genre_experience_min", q, "starGenreExperienceMin");
  rm("min_max", "star_genre_experience_max", q, "starGenreExperienceMax");
  rm("min_max", "star_relationship_min", q, "starRelationshipMin");
  rm("min_max", "star_relationship_max", q, "starRelationshipMax");
  rm("min_max", "star_relationship_range_width", q, "starRelationshipRangeWidth");
  rm("min_max", "crew_min", q, "crewMin");
  rm("min_max", "crew_max", q, "crewMax");
  rm("overall", "quality_overall_shifter_mid_point", q, "overallShifterMidPoint");
  rm("overall", "quality_overall_max_shifter", q, "overallMaxShifter");
  rm("overall", "quality_overall_max_adder", q, "overallMaxAdder");
  rm("pre_production", "pre_production", q, "preProductionTime");

  const u = t.success;
  rm("min_max", "public_interest_min", u, "publicInterestMin");
  rm("min_max", "public_interest_max", u, "publicInterestMax");
  rm("public_interest", "public_interest_ratio", u, "publicInterestRatio");
  rm("min_max", "star_ratings_of_cast_min", u, "starRatingsMin");
  rm("min_max", "star_ratings_of_cast_max", u, "starRatingsMax");
  rm("star_ratings_proportion", "star_ratings_proportion", u, "starRatingsProportion");
  rm("min_max", "genre_popularity_min", u, "genrePopularityMin");
  rm("min_max", "genre_popularity_max", u, "genrePopularityMax");
  rm("boredom", "genre_boredom_bound", u, "genreBoredomBound");
  rm("boredom", "set_boredom_bound", u, "setBoredomBound");
  rm("boredom", "star_boredom_bound", u, "starBoredomBound");
  rm("tech", "technology_pioneering_bonus", u, "technologyPioneeringBonus");
  rm("overall", "success_overall_shifter_mid_point", u, "overallShifterMidPoint");
  rm("overall", "success_overall_max_shifter", u, "overallMaxShifter");
  rm("overall", "success_overall_max_adder", u, "overallMaxAdder");
  rm("income", "revenue_multiplier", u, "revenueMultiplier");
  rm("income", "revenue_base", u, "revenueBase");
  rm("income", "pi_effect", u, "piEffect");
  rm("income", "adder_percentage", u, "adderPercentage");
  rm("income", "base_percentage", u, "basePercentage");
  rm("income", "increase_percentage", u, "increasePercentage");
  const gl = (section: string, key: string, field: keyof SuccessTuning) => readFloat(s.global, "global.ini", section, key, u, field, report);
  gl("project", "starratingboxoffice", "starRatingBoxOffice");
  gl("project", "starratingquality", "starRatingQuality");
  gl("project", "starratingawards", "starRatingAwards");
  gl("genre", "boredomboost", "genreBoredomBoost");
  gl("genre", "boredomhalflife", "genreBoredomHalfLife");
  const spend = u.marketingSpendCost;
  ["lowest", "low", "medium", "high", "highest"].forEach((level, i) =>
    readFloat(s.miscCosts, "misc_costs.ini", "project", `marketing_spend_${level}`, spend, (i + 1) as never, report));

  const a = t.actor;
  rm("min_max", "star_mood_min", a, "starMoodMin");
  rm("min_max", "star_mood_max", a, "starMoodMax");
  rm("star_mood_step", "star_mood_step", a, "starMoodStep");
  rm("min_max", "stars_genre_fit_min", a, "genreFitMin");
  rm("min_max", "stars_genre_fit_max", a, "genreFitMax");
  rm("genre_fit", "max_from_ideal", a, "genreFitMaxFromIdeal");
  const st = (section: string, key: string, field: keyof ActorTuning) => readFloat(s.stunts, "stunts.ini", section, key, a, field, report);
  st("performance", "stuntskillminimum", "stuntSkillMin");
  st("performance", "stuntskillmaximum", "stuntSkillMax");
  st("performance", "healthminimum", "healthMin");
  st("performance", "healthmaximum", "healthMax");
  st("performance", "injurymultiplier", "healthInjuryMultiplier");
  st("", "healththreshold", "healthThreshold");
  st("performance", "likenessminimum", "likenessMin");
  st("performance", "likenessmaximum", "likenessMax");
  st("performance", "likenessbonus", "likenessBonus");
  st("performance", "successminimum", "successMin");
  st("performance", "successmaximum", "successMax");
  st("performance", "stuntlevelminimum", "levelMin");
  st("performance", "stuntlevelmaximum", "levelMax");
  st("performance", "releasescreenminbound", "releaseScreenMin");
  st("performance", "releasescreenmaxbound", "releaseScreenMax");
  st("", "genderfactor", "genderFactor");
  st("", "sexfactor", "sexFactor");
  st("", "weightfactor", "weightFactor");
  st("", "agefactor", "ageFactor");
  st("", "looksfactor", "looksFactor");

  const ab = (key: string, field: keyof AwardBonusTuning) => readFloat(s.awardsBonuses, "awardsbonuses.ini", "", key, t.bonuses, field, report);
  ab("public_awareness_boost", "publicAwarenessBoost");
  ab("trendsetter_boost", "trendsetter");
  ab("genre_fit_boost", "perfectFit");
  ab("boredom_factor", "brainwasher");
  ab("lower_mood_val", "lowerMoodThreshold");
  ab("upper_mood_val", "upperMoodThreshold");

  // timeline.csv: "[constants],..." then rows "halflife,4,..."
  let inConstants = false;
  let haveHalfLife = false;
  for (const row of s.timeline) {
    if (row.length === 0) continue;
    const first = row[0]!.trim().toLowerCase();
    if (first.startsWith("[")) {
      inConstants = first === "[constants]";
      continue;
    }
    if (inConstants && first === "halflife" && row.length > 1) {
      const v = parseNumber(row[1]);
      if (v !== undefined) {
        u.trendHalfLife = f32(v);
        haveHalfLife = true;
      }
    }
  }
  if (!haveHalfLife) report.problems.push("timeline.csv [constants] halflife: missing");
  t.genreEvents = parseGenreEvents(s.timeline);
  if (t.genreEvents.size === 0) report.problems.push("timeline.csv: no genre events found");
  return t;
}

/** Reads the six files from the player's archives. A file that cannot be read is reported and its values keep their defaults. */
export async function loadMovieTuning(pak: PakIndex, report: LoadReport = newReport()): Promise<MovieTuning> {
  const s = emptySources();
  const ini = async (name: string): Promise<Ini> => {
    const text = await readDataText(pak, name);
    if (text === undefined) report.problems.push(`${name}: cannot be read`);
    return Ini.parse(text ?? "");
  };
  s.releasingMovies = await ini("releasing_movies.ini");
  s.global = await ini("global.ini");
  s.stunts = await ini("stunts.ini");
  s.awardsBonuses = await ini("awardsbonuses.ini");
  s.miscCosts = await ini("misc_costs.ini");
  const timeline = await readDataText(pak, "timeline.csv");
  if (timeline === undefined) report.problems.push("timeline.csv: cannot be read");
  s.timeline = parseCsv(timeline ?? "");
  return buildMovieTuning(s, report);
}
