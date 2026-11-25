// The staff tuning (experience table, stunts, star rating weights, award bonus values) from the game's data files: experience.ini, stunts.ini,
// global.ini ([star]) and awardsbonuses.ini. Like the movie tuning loader: a missing or unreadable value keeps its default and is reported.
import type { PakIndex } from "../../assets/Pak.ts";
import { Ini } from "../../formats/Ini.ts";
import { newReport, readDataText, readFloat, type LoadReport } from "../core/Tuning.ts";
import { defaultStarRatingTuning, type StarRatingTuning } from "./StarRating.ts";
import { defaultStuntTuning, type StuntTuning } from "./Stunts.ts";
import { defaultExperienceTable, EXPERIENCE_KEYS, type ExperienceTable } from "./Traits.ts";

const f32 = Math.fround;

/**
 * awardsbonuses.ini: the bonuses that change experience. Which key belongs to which character type for the generic experience bonus (award bonus 1,
 * "Quick Learner") is not decoded, so all five are loaded.
 */
export interface StaffBonusTuning {
  /** natural_talent_factor: multiplies stunt XP (award bonus 0xF) */
  naturalTalent: number;
  starsExperienceBoost: number; // stars_experience_boost
  crewExperienceBoost: number; // crew_experience_boost
  lotExperienceBoost: number; // lot_experience_boost
  writersExperienceBoost: number; // writers_experience_boost
  researchersExperienceBoost: number; // researchers_experience_boost
  /** thick_skin_factor: scales damage taken */
  thickSkinFactor: number;
}

export function defaultStaffBonusTuning(): StaffBonusTuning {
  return {
    naturalTalent: f32(1.2), starsExperienceBoost: f32(1.1), crewExperienceBoost: f32(1.1), lotExperienceBoost: f32(1.1), writersExperienceBoost: f32(1.1),
    researchersExperienceBoost: f32(1.1), thickSkinFactor: f32(0.8),
  };
}

export interface StaffTuning {
  experience: ExperienceTable;
  stunts: StuntTuning;
  starRating: StarRatingTuning;
  bonuses: StaffBonusTuning;
}

export interface StaffTuningSources {
  experience: Ini;
  stunts: Ini;
  global: Ini;
  awardsBonuses: Ini;
}

export function emptyStaffSources(): StaffTuningSources {
  const e = Ini.parse("");
  return { experience: e, stunts: e, global: e, awardsBonuses: e };
}

/** Builds the tuning from parsed sources (no file access). */
export function buildStaffTuning(s: StaffTuningSources, report: LoadReport = newReport()): StaffTuning {
  const t: StaffTuning = { experience: defaultExperienceTable(), stunts: defaultStuntTuning(), starRating: defaultStarRatingTuning(), bonuses: defaultStaffBonusTuning() };
  const ex = t.experience;
  EXPERIENCE_KEYS.forEach((key, i) => readFloat(s.experience, "experience.ini", "", key, ex.values, i as never, report));
  const e = (key: string, field: keyof ExperienceTable) => readFloat(s.experience, "experience.ini", "", key, ex, field, report);
  e("stars_experience_interval", "starsExperienceInterval");
  e("stars_experience_decay", "starsExperienceDecay");
  e("StaffStartMinExp", "staffStartMinExp");
  e("StaffStartMaxExp", "staffStartMaxExp");
  e("CrewStartMinExp", "crewStartMinExp");
  e("CrewStartMaxExp", "crewStartMaxExp");

  const st = (section: string, key: string, field: keyof StuntTuning) => readFloat(s.stunts, "stunts.ini", section, key, t.stunts, field, report);
  st("", "healththreshold", "healthThreshold");
  st("successfailure", "stuntabilityinjurymodifier", "abilityInjuryModifier");
  st("successfailure", "maxhealthability", "maxHealthAbility");
  st("successfailure", "minhealthability", "minHealthAbility");
  st("successfailure", "stuntchancelow", "chanceLow");
  st("successfailure", "stuntchancemedium", "chanceMedium");
  st("successfailure", "stuntchancehigh", "chanceHigh");
  st("successfailure", "stuntchancemin", "chanceMin");
  st("successfailure", "stuntchancemax", "chanceMax");
  st("successfailure", "luckycharmbonus", "luckyCharmBonus");
  st("injuries", "stuntdamageskillmultiplier", "damageSkillMultiplier");
  st("injuries", "maxhealthlossstuntfailure", "maxHealthLossFailure");
  st("injuries", "minhealthlossstuntfailure", "minHealthLossFailure");
  st("injuries", "maxhealthlossstuntsuccess", "maxHealthLossSuccess");
  st("injuries", "minhealthlossstuntsuccess", "minHealthLossSuccess");
  st("experience", "stuntxpsuccessmin", "xpSuccessMin");
  st("experience", "stuntxpsuccessmax", "xpSuccessMax");
  st("experience", "stuntxpfailuremin", "xpFailureMin");
  st("experience", "stuntxpfailuremax", "xpFailureMax");
  st("experience", "actorstuntskillmodifier", "actorStuntSkillModifier");
  st("experience", "stuntmangenremodifier", "stuntmanGenreModifier");
  st("training", "stuntxpsuccessmin", "trainingXpSuccessMin");
  st("training", "stuntxpsuccessmax", "trainingXpSuccessMax");
  st("training", "stuntxpfailuremin", "trainingXpFailureMin");
  st("training", "stuntxpfailuremax", "trainingXpFailureMax");
  st("training", "stuntxpincreasemin", "trainingXpIncreaseMin");
  st("training", "lowhealthmultiplier", "trainingLowHealthMultiplier");

  const g = (key: string, field: keyof StarRatingTuning) => readFloat(s.global, "global.ini", "star", key, t.starRating, field, report);
  g("starratingweightmovies", "weightMovies");
  g("starratingweightsalary", "weightSalary");
  g("starratingweightperformance", "weightPerformance");
  g("starratingweightimage", "weightImage");
  g("starratingweightentourage", "weightEntourage");
  g("starratingweighttrailer", "weightTrailer");
  g("starratingweightpressbar", "weightPressBar");
  g("starratingweightrelationships", "weightRelationships");
  g("starratingweightawards", "weightAwards");
  g("ratingsmultiplier", "ratingsMultiplier");
  g("ratingshalflife", "ratingsHalfLife");

  const ab = (key: string, field: keyof StaffBonusTuning) => readFloat(s.awardsBonuses, "awardsbonuses.ini", "", key, t.bonuses, field, report);
  ab("natural_talent_factor", "naturalTalent");
  ab("stars_experience_boost", "starsExperienceBoost");
  ab("crew_experience_boost", "crewExperienceBoost");
  ab("lot_experience_boost", "lotExperienceBoost");
  ab("writers_experience_boost", "writersExperienceBoost");
  ab("researchers_experience_boost", "researchersExperienceBoost");
  ab("thick_skin_factor", "thickSkinFactor");
  return t;
}

/** Reads the four files from the player's archives. */
export async function loadStaffTuning(pak: PakIndex, report: LoadReport = newReport()): Promise<StaffTuning> {
  const ini = async (name: string): Promise<Ini> => {
    const text = await readDataText(pak, name);
    if (text === undefined) report.problems.push(`${name}: cannot be read`);
    return Ini.parse(text ?? "");
  };
  return buildStaffTuning({ experience: await ini("experience.ini"), stunts: await ini("stunts.ini"), global: await ini("global.ini"), awardsBonuses: await ini("awardsbonuses.ini") }, report);
}
