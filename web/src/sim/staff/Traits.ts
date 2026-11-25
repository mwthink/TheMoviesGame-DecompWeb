// Character traits and the experience table: how skills grow.
//
// From TraitContainer_Get/Set/Add (0x441750 / 0x442490 / 0x4425F0), ExperienceTable_Get (0x440130) and CStaff_AddGenreExperience (0x57C250).
// Derivation: docs/TRAITS_AND_EXPERIENCE.md sections 1, 2.
//
// A trait is a named float in [0, 1] ("Stunts", "Movies", one per genre, ...). Experience gains are fractions of the remaining headroom:
// new = old + (1 - old) * gain, so skills level off as they approach 1.
import { clamp01 } from "../movie/MovieQuality.ts";

const f32 = Math.fround;

export class TraitMap {
  /** Keys are case-sensitive as in the game ("Stunts", "Movies"); genres are lower-case. */
  readonly values = new Map<string, number>();

  /** TraitContainer_Get: the value, or 0 if the trait does not exist. orig: 0x00441750 */
  get(name: string): number {
    return this.values.get(name) ?? 0;
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  /** TraitContainer_Set: stores clamp01(value). orig: 0x00442490 */
  set(name: string, value: number): void {
    this.values.set(name, f32(clamp01(value)));
  }

  /**
   * TraitContainer_Add: a diminishing-returns gain. bonusMultiplier is the experience award bonus value (award bonus 1) when that bonus is active, 1
   * otherwise. A trait that does not exist yet starts at the gain itself. Returns the amount gained before clamping (for a new trait, the gain).
   * orig: 0x004425F0
   */
  add(name: string, gain: number, bonusMultiplier = 1): number {
    gain = f32(bonusMultiplier * gain);
    const old = this.values.get(name);
    if (old === undefined) {
      this.set(name, gain);
      return gain;
    }
    const delta = f32(f32(1 - old) * gain);
    this.set(name, f32(old + delta));
    return delta;
  }
}

/** Indexes into the 20-entry table loaded from experience.ini (the order of ExperienceTable_Load). */
export const Experience = {
  LotPerHammerBuild: 0, LotPerLitterSwept: 1, LotPerHammerRepair: 2, SetRehearseLoop: 3, SetWatchRehearseLoop: 4, SetWatchShootLoop: 5,
  SetRehearseIncrement: 6, SetWatchIncrement: 7, SetWatchShootIncrement: 8, SetRehearseTime: 9, MoviesWriterStart: 10, MoviesScientistStart: 11,
  MoviesScientistIncrementPerMonth: 12, MoviesCrewPerShot: 13, MoviesLeadRole: 14, MoviesSupportRole: 15, MoviesDirector: 16, ScriptQualityGain: 17,
  ScriptExpGain: 18, MoviesStuntman: 19,
} as const;
export type Experience = (typeof Experience)[keyof typeof Experience];

/** The experience.ini key of each entry, in table order. */
export const EXPERIENCE_KEYS = [
  "LOT_PERHAMMERBUILD", "LOT_PERLITTERSWEPT", "LOT_PERHAMMERREPAIR", "SET_REHEARSELOOP", "SET_WATCHREHEARSELOOP", "SET_WATCHSHOOTLOOP",
  "SET_REHEARSE_INCREMENT", "SET_WATCH_INCREMENT", "SET_WATCHSHOOT_INCREMENT", "SET_REHEARSE_TIME", "MOVIES_WRITERSTART", "MOVIES_SCIENTISTSTART",
  "MOVIES_SCIENTIST_INCREMENT_PER_MONTH", "MOVIES_CREWPERSHOT", "MOVIES_LEADROLE", "MOVIES_SUPPORTROLE", "MOVIES_DIRECTOR", "SCRIPT_QUALITY_GAIN",
  "SCRIPT_EXP_GAIN", "MOVIES_STUNTMAN",
] as const;

export interface ExperienceTable {
  /** The shipped experience.ini values by default. */
  values: number[];
  starsExperienceInterval: number; // stars_experience_interval
  starsExperienceDecay: number; // stars_experience_decay
  staffStartMinExp: number; // StaffStartMinExp / MaxExp
  staffStartMaxExp: number;
  crewStartMinExp: number; // CrewStartMinExp / MaxExp
  crewStartMaxExp: number;
}

export function defaultExperienceTable(): ExperienceTable {
  return {
    values: [0.0006, 0.004, 0.0003, 0.01, 0.005, 0.0075, 0.1, 0.05, 0.75, 600, 0.1, 0.1, 0.011, 0.02, 0.026, 0.013, 0.026, 0.0004, 0.00002, 0.013].map(f32),
    starsExperienceInterval: f32(5), starsExperienceDecay: f32(0.002),
    staffStartMinExp: f32(0.1), staffStartMaxExp: f32(0.1), crewStartMinExp: f32(0.1), crewStartMaxExp: f32(0.1),
  };
}

/** ExperienceTable_Get: the entry clamped to 0..1 (negative gives 0). orig: 0x00440130 */
export function experience(table: ExperienceTable, e: Experience): number {
  const v = table.values[e]!;
  if (v < 0) return 0;
  return v > 1 ? 1 : v;
}

/** What a cast member is in the project, which decides the genre experience a take gives them. */
export type CastRole = "director" | "lead" | "support" | "other";

/**
 * The amount CStaff_AddGenreExperience adds to the trait named after the movie's genre: the director gets MoviesDirector, a lead MoviesLeadRole, a
 * supporting actor MoviesSupportRole and anyone else MoviesStuntman; a character whose job is stuntman (job 16) gets it times stuntmanGenreModifier
 * (stunts.ini [experience] stuntmangenremodifier, 0.7). orig: 0x0057C250
 */
export function genreExperienceGain(role: CastRole, jobIsStuntman: boolean, table: ExperienceTable, stuntmanGenreModifier = f32(0.7)): number {
  const e = role === "director" ? Experience.MoviesDirector : role === "lead" ? Experience.MoviesLeadRole : role === "support" ? Experience.MoviesSupportRole : Experience.MoviesStuntman;
  const gain = experience(table, e);
  return jobIsStuntman ? f32(stuntmanGenreModifier * gain) : gain;
}
