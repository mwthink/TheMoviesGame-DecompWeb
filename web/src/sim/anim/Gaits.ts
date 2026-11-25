/**
 * How characters walk (docs/MOVEMENT.md): the animation ids, the gait file and how the game chooses a locomotion state.
 *
 * [read] `AnimIdTable_InitFromGaitIni` (orig 0x00446880) builds a table of 48 animation ids from the keys `A_MALE_WALK`, `A_MALE_WALK_MIDDLE` ... `A_WALK_WOUNDED_LOT`; the file
 * `data\gait.ini` maps each key to a clip (`A_MALE_WALK = walk.anm`), and the table keeps each clip's stride times 0.1 as its move speed. A character has three gaits for its
 * locomotion states (`TMCharacter_SetDefaultGaits`, orig 0x00598C30): state 0 (a stroll), 1 (a walk) and 2 (a run).
 */

/** The 48 animation ids in order (the index is the id the game's code uses: `TMCharacter_ResetToIdlePose` plays id 0x29 = 41, `A_IDLE`). */
export const ANIM_IDS = [
  "A_MALE_WALK", "A_MALE_WALK_MIDDLE", "A_MALE_WALK_MATURE", "A_MALE_WALK_OLD", "A_MALE_WALK_FAT", "A_MALE_WALK_FAT_MATURE", "A_MALE_WALK_FAT_OLD", "A_MALE_RUN_OLD",
  "A_FEMALE_RUN_OLD", "A_MALE_STROLL", "A_MALE_RUN", "A_FEMALE_WALK", "A_FEMALE_WALK2", "A_FEMALE_WALK_MIDDLE", "A_FEMALE_WALK_MATURE", "A_FEMALE_WALK_MORE_MATURE",
  "A_FEMALE_WALK_OLD", "A_FEMALE_WALK_FAT", "A_FEMALE_WALK_FAT_MATURE", "A_FEMALE_WALK_FAT_OLD", "A_FEMALE_STROLL", "A_FEMALE_RUN", "A_MALE_BORED_WALK", "A_FEMALE_BORED_WALK",
  "A_MALE_SAD_WALK", "A_FEMALE_SAD_WALK", "A_HAPPY_WALK", "A_MALE_LOWEGO_WALK", "A_FEMALE_LOWEGO_WALK", "A_MALE_HIGHEGO_WALK", "A_FEMALE_HIGHEGO_WALK", "A_MALE_MIDEGO_WALK",
  "A_FEMALE_MIDEGO_WALK", "A_RUNNER_RUN", "A_RUNNER_RUN2", "A_TURN_POS_10", "A_TURN_POS_22", "A_TURN_POS_45", "A_TURN_NEG_10", "A_TURN_NEG_22", "A_TURN_NEG_45", "A_IDLE",
  "A_MALE_DRUNK_WALK", "A_FEMALE_DRUNK_WALK", "A_VDRUNK_WALK", "A_WALK_THINK", "A_WALK_WOUNDED_BIT", "A_WALK_WOUNDED_LOT",
] as const;

/** Parse `gait.ini`: `KEY = clip.anm` lines (upper-cased keys, comments and blanks ignored). */
export function parseGaitIni(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(\S+)/.exec(line);
    if (m) out.set(m[1]!.toUpperCase(), m[2]!.toLowerCase());
  }
  return out;
}

/** The three gaits of a character as animation ids: a stroll, a walk and a run. */
export interface Gaits { stroll: number; walk: number; run: number; }

/**
 * `TMCharacter_SetDefaultGaits` (orig 0x00598C30): a man strolls with `A_MALE_STROLL` (9), walks with `A_MALE_WALK` (0) and runs with `A_MALE_RUN` (10); a woman strolls with
 * `A_FEMALE_STROLL` (20), walks with `A_FEMALE_WALK` (11) or, when a flag at `+0x660` is set, `A_FEMALE_WALK2` (12), and runs with `A_FEMALE_RUN` (21).
 */
export function defaultGaits(female: boolean, secondWalk = false): Gaits {
  return female ? { stroll: 20, walk: secondWalk ? 12 : 11, run: 21 } : { stroll: 9, walk: 0, run: 10 };
}

/** The clip file for an animation id, from the parsed `gait.ini`; undefined when the file has no such key. */
export function gaitClipFile(ini: Map<string, string>, id: number): string | undefined {
  const key = ANIM_IDS[id];
  return key ? ini.get(key) : undefined;
}

/** Locomotion states (`TMCharacter +0x4E8`): 0 stroll, 1 walk, 2 run (3 and 5 are other modes: 5 is standing still). */
export type Locomotion = 0 | 1 | 2;

/**
 * `TMCharacter_UpdateLocomotionStateFromSpeed` (orig 0x00599630): the state follows a 0..1 "urgency" the character's action gives (`TMCharacter_UpdateMoveSpeed`, `+0x52C`): under 0.3 a
 * stroll, under 0.7 a walk, otherwise a run.
 */
export function locomotionForUrgency(urgency: number): Locomotion {
  return urgency < 0.3 ? 0 : urgency < 0.7 ? 1 : 2;
}

/**
 * The animation id of the turn-on-the-spot clip for a heading change, `TMCharacter_PlayTurnAnimation` (orig 0x00447AE0). `delta` is the current heading minus the target heading,
 * wrapped to (-pi, pi]. Under 5 degrees no clip plays; 5 to 12 degrees the 10-degree clip, 12 to 36 the 22-degree clip, above that the 45-degree clip; a delta that is zero or
 * negative uses the `A_TURN_NEG_*` clips (ids 38 to 40) and a positive one the `A_TURN_POS_*` ones (35 to 37).
 */
export function turnClipId(delta: number): number | null {
  const deg = Math.abs(delta) * (180 / Math.PI);
  if (deg < 5) return null;
  const size = deg >= 36 ? 2 : deg >= 12 ? 1 : 0;
  return (delta <= 0 ? 38 : 35) + size;
}

/** The id of `A_IDLE`. */
export const IDLE_ID = 41;
