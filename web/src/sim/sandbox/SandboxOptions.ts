// The nine start options (TM::CSandbox, "Option[0..8]" in a save file) and the sandbox screen's checkboxes that set them.
//
// From CSandbox_ResetOptions (0x004AF370, the defaults), WProfileScreen_OnConfirm (0x006E1220, case 1: which checkbox sets which option), WSandboxOptions
// (0x0070D020, the checkboxes, their defaults and toggle handlers), CSandbox_RegisterSaveVariables (0x004AF720, nine 4-byte values in every save) and
// Campaign_Begin (0x004AF870, the start decade). What each option does was read from its readers (docs/FRONTEND.md, "The nine start options"). Not
// compared with the running game.

const f32 = Math.fround;

/** Indexes into the option array at CSandbox +0x60, nine floats. */
export const Option = {
  /** (startYear - 1900) / 10; -1.0 until a year is chosen. Read by the start-date setter: decade * 10 + 1900 */
  StartDecade: 0,
  /** != 0: CMood_Recalculate is skipped (moods stay put), the work bar's Stress and Boredom and the star's addiction levels are held at 0, and a
   * character's top desire counts as 0 */
  StarsDontMisbehave: 1,
  /** > 0: an asset's condition is held at 1.0 and its disrepair flags are cleared */
  BuildingsDontDecay: 2,
  /** > 0: a take ends as soon as it begins (the stunt outcome is rolled once) and the pre-production factor is 1.0 */
  InstantMovie: 3,
  /** nothing ever sets it; DesireWriteScript_UpdateProgress would skip the "Writing" progress if it were > 0 */
  Unused: 4,
  /** != 0: a placed asset goes straight to its built state (4) instead of under construction (1) */
  InstantBuild: 5,
  /** 0 tutorial, 1 new game, 2 sandbox, 3 add-on quick start */
  GameType: 6,
  /** != 0: the health setters (CStar, CExtra, CWannabe) store 1.0 instead of the value passed in, so health cannot drop */
  StuntInjuriesOff: 7,
  /** != 0: stunt and stuntman paths are skipped (stunt rolls, leads room, script room, reviews, release screen, the tutorial popup) */
  StuntmenOff: 8,
} as const;
export type Option = (typeof Option)[keyof typeof Option];
export const OPTION_COUNT = 9;

export const GameType = { Tutorial: 0, NewGame: 1, Sandbox: 2, AddOnQuickStart: 3 } as const;
export type GameType = (typeof GameType)[keyof typeof GameType];

/** The nine option floats, by Option index. */
export type Options = number[];

/**
 * [0] = -1.0, [1..5] = 0, [6] = 1.0 (new game); [7] and [8] are 0 when FUN_00541F60(0) is true, which is always (it returns `param == 0` and the call
 * passes 0), and 1.0 otherwise. orig: 0x004AF370
 */
export function defaultOptions(stuntContentEnabled = true): Options {
  const o = new Array<number>(OPTION_COUNT).fill(0);
  o[Option.StartDecade] = -1;
  o[Option.GameType] = 1;
  o[Option.StuntInjuriesOff] = o[Option.StuntmenOff] = stuntContentEnabled ? 0 : 1;
  return o;
}

/** The sandbox options screen (WSandboxOptions). The bytes are the object's fields; the original flips each with `x = (x == 0)`. */
export interface SandboxChoices {
  /** +0x77C */
  instantBuild: boolean;
  /** +0x77D */
  instantShoot: boolean;
  /** +0x77E */
  starsDontMisbehave: boolean;
  /** +0x77F (the row is labelled "Buildings Don't Decay", so it reads inverted) */
  buildingsDecay: boolean;
  /** +0x780 (add-on) */
  stuntmen: boolean;
  /** +0x781 (add-on) */
  stuntInjuries: boolean;
  /**
   * DAT_0104DE24, a global, default 1: when set, Campaign_Begin appends "_clean" to the layout name (an empty lot) for sandbox and add-on quick start
   * games. quirk: the row is labelled "Start With A Ready Built Studio Lot", so its ON text (a basic setup) is flag 0.
   */
  emptyLot: boolean;
}

/** The screen's own defaults (the WSandboxOptions constructor): decay on, everything else off, ready-built lot on. */
export function defaultSandboxChoices(): SandboxChoices {
  return { instantBuild: false, instantShoot: false, starsDontMisbehave: false, buildingsDecay: true, stuntmen: false, stuntInjuries: false, emptyLot: true };
}

/** Sets GameType = 2.0 and six options from the checkboxes; the others keep their values. orig: 0x006E1220 (case 1) */
export function applySandboxChoices(o: Options, c: SandboxChoices): void {
  o[Option.GameType] = 2;
  o[Option.StarsDontMisbehave] = c.starsDontMisbehave ? 1 : 0;
  o[Option.BuildingsDontDecay] = c.buildingsDecay ? 0 : 1; // [2] = (+0x77F == 0)
  o[Option.InstantBuild] = c.instantBuild ? 1 : 0;
  o[Option.InstantMovie] = c.instantShoot ? 1 : 0;
  o[Option.StuntmenOff] = c.stuntmen ? 0 : 1; // [8] = (+0x780 == 0)
  o[Option.StuntInjuriesOff] = c.stuntInjuries ? 0 : 1; // [7] = (+0x781 == 0)
}

/** Campaign_Begin stores (float)((year - 0x76C) / 10), integer division; 0x76C is 1900. orig: 0x004AF870 */
export function setStartYear(o: Options, year: number): void {
  o[Option.StartDecade] = Math.trunc((year - 1900) / 10);
}

/** The inverse the date setter uses: decade * 10 + 1900. */
export function startYear(o: Options): number {
  return Math.trunc(f32(f32(o[Option.StartDecade]! * 10) + 1900));
}
