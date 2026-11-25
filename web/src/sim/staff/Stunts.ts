// The stunt system: the success roll at the start of a take, injuries, experience and stunt-school training.
//
// From ShootController_RollStuntOutcome (0x4EA1D0), ShootController_ApplyStuntConsequences (0x4E2240), CStaff_AddStuntExperience (0x57C410) and
// StuntTraining_ApplyExperience (0x83D1A0). Derivation: docs/STUNT_SYSTEM.md.
//
// Pure arithmetic: the performers' traits, health and the scene's difficulty are parameters. The random draw uses the game's own linear congruential
// generator so a roll can be reproduced from a seed. Nothing here is verified against the running game; the formulas follow the decompiled code (a
// captured failed take only shows that a failure sets ai_stunt_fail = 1).
import { clamp01 } from "../movie/MovieQuality.ts";
import type { TraitMap } from "./Traits.ts";

const f32 = Math.fround;

/** stunts.ini: [successfailure], [injuries], [experience], [training] and the health threshold before the first section. */
export interface StuntTuning {
  healthThreshold: number; // healththreshold
  abilityInjuryModifier: number; // [successfailure] stuntabilityinjurymodifier
  maxHealthAbility: number; // maxhealthability
  minHealthAbility: number; // minhealthability
  chanceLow: number; // stuntchancelow (at difference -1)
  chanceMedium: number; // stuntchancemedium (at difference 0)
  chanceHigh: number; // stuntchancehigh (at difference +1)
  chanceMin: number; // stuntchancemin
  chanceMax: number; // stuntchancemax
  luckyCharmBonus: number; // luckycharmbonus
  damageSkillMultiplier: number; // [injuries] stuntdamageskillmultiplier
  maxHealthLossFailure: number; // maxhealthlossstuntfailure
  minHealthLossFailure: number; // minhealthlossstuntfailure
  maxHealthLossSuccess: number; // maxhealthlossstuntsuccess
  minHealthLossSuccess: number; // minhealthlossstuntsuccess
  xpSuccessMin: number; // [experience] stuntxpsuccessmin
  xpSuccessMax: number; // stuntxpsuccessmax
  xpFailureMin: number; // stuntxpfailuremin
  xpFailureMax: number; // stuntxpfailuremax
  /** actorstuntskillmodifier: non-stuntmen learn less */
  actorStuntSkillModifier: number;
  /** stuntmangenremodifier (used by genreExperienceGain) */
  stuntmanGenreModifier: number;
  trainingXpSuccessMin: number; // [training] stuntxpsuccessmin
  trainingXpSuccessMax: number; // stuntxpsuccessmax
  trainingXpFailureMin: number; // stuntxpfailuremin
  trainingXpFailureMax: number; // stuntxpfailuremax
  /** stuntxpincreasemin: training never lowers skill */
  trainingXpIncreaseMin: number;
  trainingLowHealthMultiplier: number; // lowhealthmultiplier
}

export function defaultStuntTuning(): StuntTuning {
  return {
    healthThreshold: f32(0.01), abilityInjuryModifier: f32(0.7), maxHealthAbility: f32(1), minHealthAbility: f32(0.5),
    chanceLow: f32(-0.4), chanceMedium: f32(0.8), chanceHigh: f32(1.1), chanceMin: f32(0.05), chanceMax: f32(0.98), luckyCharmBonus: f32(0.1),
    damageSkillMultiplier: f32(0.3), maxHealthLossFailure: f32(0.8), minHealthLossFailure: f32(0.1), maxHealthLossSuccess: f32(0.2), minHealthLossSuccess: f32(0.1),
    xpSuccessMin: f32(0.02), xpSuccessMax: f32(0.06), xpFailureMin: f32(0.01), xpFailureMax: f32(0.04), actorStuntSkillModifier: f32(0.7),
    stuntmanGenreModifier: f32(0.7), trainingXpSuccessMin: f32(-0.04), trainingXpSuccessMax: f32(0.04), trainingXpFailureMin: f32(-0.03),
    trainingXpFailureMax: f32(0.03), trainingXpIncreaseMin: f32(0.005), trainingLowHealthMultiplier: f32(0.1),
  };
}

const DEFAULT = defaultStuntTuning();

/**
 * A performer's stunt score for the roll: clamp01(Stunts trait * health ability). The health ability runs from minHealthAbility to maxHealthAbility
 * with health, and is multiplied by abilityInjuryModifier below the health threshold. orig: 0x004EA1D0
 */
export function stuntActorScore(stuntsTrait: number, health: number, t: StuntTuning = DEFAULT): number {
  const modifier = health < t.healthThreshold ? t.abilityInjuryModifier : 1;
  let ability = clamp01(f32(f32(clamp01(f32(t.maxHealthAbility - t.minHealthAbility)) * health) + t.minHealthAbility));
  ability = clamp01(f32(ability * modifier));
  return clamp01(f32(stuntsTrait * ability));
}

/**
 * The success chance for a cast whose mean score is castScore against the scene's difficulty (both 0..1): piecewise linear through (-1, low),
 * (0, medium), (+1, high), plus the Lucky Charm bonus, clamped to [chanceMin, chanceMax]. orig: 0x004EA1D0
 */
export function stuntSuccessChance(castScore: number, difficulty: number, luckyCharm: boolean, t: StuntTuning = DEFAULT): number {
  const diff = f32(castScore - difficulty);
  let chance = diff >= 0 ? f32(f32(f32(t.chanceHigh - t.chanceMedium) * diff) + t.chanceMedium) : f32(t.chanceMedium - f32(f32(t.chanceLow - t.chanceMedium) * diff));
  if (luckyCharm) chance = f32(chance + t.luckyCharmBonus);
  if (chance <= t.chanceMin) chance = t.chanceMin;
  return clamp01(t.chanceMax <= chance ? t.chanceMax : chance);
}

/** The game's private random generator's state. The game seeds it from the millisecond clock the first time it is used (seed 0); the caller does that here. */
export interface StuntRandom {
  seed: number;
}

/** seed = seed * 0x19660D + 0x3C6EF35F (32-bit); the value is bits 6..28 of the new seed / 2^23. orig: 0x004EA1D0 */
export function nextRandomUnit(r: StuntRandom): number {
  r.seed = (Math.imul(r.seed, 0x19660d) + 0x3c6ef35f) >>> 0;
  return f32(((r.seed >>> 6) & 0x7fffff) * f32(1.192093e-7));
}

export interface StuntRoll {
  /** false when there is no stunt performer (nothing is rolled and the take cannot fail) */
  rolled: boolean;
  /** the mean of the performers' scores (controller+0xF8) */
  castScore: number;
  /** the success chance (controller+0xF4) */
  chance: number;
  /** controller+0xF0, published as the channel ai_stunt_fail */
  failed: boolean;
}

/**
 * ShootController_RollStuntOutcome: one roll per take. performerScores holds stuntActorScore of each performer (the stunt double if the role has one,
 * else the actor) of every role with a stunt weight above 0. orig: 0x004EA1D0
 */
export function rollStuntOutcome(performerScores: readonly number[], difficulty: number, luckyCharm: boolean, random: StuntRandom, t: StuntTuning = DEFAULT): StuntRoll {
  if (performerScores.length === 0) return { rolled: false, castScore: 0, chance: 0, failed: false };
  let sum = 0;
  for (const s of performerScores) sum = f32(s + sum);
  const castScore = f32(sum / performerScores.length);
  const chance = stuntSuccessChance(castScore, difficulty, luckyCharm, t);
  return { rolled: true, castScore, chance, failed: !(nextRandomUnit(random) < chance) }; // success only if the draw is below the chance
}

/**
 * The health a performer loses after the take (ApplyStuntConsequences): the skill reduces the stunt's danger.
 * danger = clamp01(difficulty - clamp01(damageSkillMultiplier * Stunts)); loss = lerp(min, max, danger) for the outcome. orig: 0x004E2240
 */
export function stuntHealthLoss(stuntsTrait: number, difficulty: number, failed: boolean, t: StuntTuning = DEFAULT): number {
  const skill = clamp01(f32(t.damageSkillMultiplier * stuntsTrait));
  const danger = clamp01(f32(difficulty - skill));
  const hi = failed ? t.maxHealthLossFailure : t.maxHealthLossSuccess;
  const lo = failed ? t.minHealthLossFailure : t.minHealthLossSuccess;
  return clamp01(f32(f32(f32(hi - lo) * danger) + lo));
}

/**
 * Stunt XP of one take (CStaff_AddStuntExperience): (max - min) * difficulty + min for success or failure, times the Natural Talent award bonus when
 * active (pass < 0 for "not active"), times actorStuntSkillModifier unless the job is stuntman. orig: 0x0057C410
 */
export function stuntExperienceGain(difficulty: number, success: boolean, jobIsStuntman: boolean, naturalTalentMultiplier = -1, t: StuntTuning = DEFAULT): number {
  let xp = success ? f32(f32(f32(t.xpSuccessMax - t.xpSuccessMin) * difficulty) + t.xpSuccessMin) : f32(f32(f32(t.xpFailureMax - t.xpFailureMin) * difficulty) + t.xpFailureMin);
  if (naturalTalentMultiplier >= 0) xp = f32(naturalTalentMultiplier * xp);
  if (!jobIsStuntman) xp = f32(t.actorStuntSkillModifier * xp);
  return xp;
}

/** Adds that XP to the "Stunts" trait (traitBonus is the experience award bonus, see TraitMap.add). Returns the gain. orig: 0x0057C410 */
export function addStuntExperience(traits: TraitMap, difficulty: number, success: boolean, jobIsStuntman: boolean, naturalTalentMultiplier = -1, traitBonus = 1, t: StuntTuning = DEFAULT): number {
  return traits.add("Stunts", stuntExperienceGain(difficulty, success, jobIsStuntman, naturalTalentMultiplier, t), traitBonus);
}

/**
 * Stunt-school training XP (StuntTraining_ApplyExperience): the better the session's level matches the trainee's Stunts trait, the more they gain; the
 * range is negative-to-positive, but the result never drops below trainingXpIncreaseMin, and a badly injured trainee (health below the threshold) gets
 * only trainingLowHealthMultiplier of it. orig: 0x0083D1A0
 */
export function stuntTrainingXp(sessionLevel: number, stuntsTrait: number, success: boolean, health: number, naturalTalentMultiplier = -1, t: StuntTuning = DEFAULT): number {
  const match = f32(1 - Math.abs(f32(sessionLevel - stuntsTrait)));
  const lo = success ? t.trainingXpSuccessMin : t.trainingXpFailureMin;
  const hi = success ? t.trainingXpSuccessMax : t.trainingXpFailureMax;
  let xp = f32(f32(f32(clamp01(hi) - lo) * match) + lo);
  if (naturalTalentMultiplier >= 0) xp = f32(naturalTalentMultiplier * xp);
  if (xp <= t.trainingXpIncreaseMin) xp = t.trainingXpIncreaseMin;
  if (health < t.healthThreshold) xp = f32(t.trainingLowHealthMultiplier * xp);
  return xp;
}
