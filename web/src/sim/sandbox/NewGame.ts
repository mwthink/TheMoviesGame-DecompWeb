// A new game's starting state as a `Save`, so the world loader draws it the way it draws a loaded game (docs/NEW_GAME.md: a new game and a load differ
// only in what is put into the freshly built systems). Not the original's own path: that runs Game_ConstructSystems (0x422750) and
// Lot_LoadStartingLayout (0x46A780); this keeps only what the picture needs.
import type { Ini } from "../../formats/Ini.ts";
import type { Landscape, PlacedAsset, Save } from "../../formats/Jad.ts";
import { GameType, defaultOptions, setStartYear, type Options } from "./SandboxOptions.ts";
import { startingLayoutName, type StartingLayout } from "./StartingLayout.ts";

/** What the profile screen collects (WProfileScreen_OnConfirm, 0x6E1220). */
export interface NewGameProfile {
  studioName: string;
  ownerName: string;
}

/** The start values of global.ini: `[studio] startfunds` and `[time] start = <year>,<n>`. [data] 150000 and 1920,20. */
export interface StartConfig {
  year: number;
  funds: number;
}

export function parseStartConfig(global: Ini): StartConfig {
  const year = Number.parseInt(global.get("time/start") ?? "", 10);
  const funds = Number(global.get("studio/startfunds"));
  return { year: Number.isFinite(year) ? year : 1920, funds: Number.isFinite(funds) ? funds : 150000 };
}

/** The game's day count is 365 per year (SaveHeader.date), so 1 January of a year is year * 365. [data] the fresh-studio save of 1920 holds 700800. */
export function startDate(year: number): number {
  return year * 365;
}

/** The name of the layout a normal new game loads: `savedefaults/<year>`. orig: 0x004AF870 */
export function newGameLayoutName(year: number): string {
  return startingLayoutName(false, year, GameType.NewGame, false).name;
}

/** The options a new game starts with: the defaults, game type 1, the start decade. orig: WProfileScreen_OnConfirm mode 0 */
export function newGameOptions(year: number): Options {
  const o = defaultOptions();
  o[6] = GameType.NewGame;
  setStartYear(o, year);
  return o;
}

/**
 * What every studio starts with, whatever the layout lists: the lot, its billboard and the gatehouse (`CLot_LoadPerimeterAssets` makes the gatehouse).
 * [data] positions as in the fresh-studio save of 1920 (a blank lot straight after the tutorial), which has exactly these three objects.
 */
export const LOT_FURNITURE: readonly Omit<PlacedAsset, "id">[] = [
  { cls: "CLot", source: "lot", position: [0, 0, 0], angle: 0 },
  { cls: "CSponsoredBillboard", source: "ornament/p_billboard", position: [43.24, 2.47, 0], angle: 0 },
  { cls: "CFacility", source: "facility/facility_gatehouse", position: [-28, 10, 0], angle: 0 },
];

const CLASS_OF_KIND = { facility: "CFacility", set: "CSet", ornament: "COrnament", other: "COrnament" } as const;

/** `global.ini` `[awards] interval`: the years between ceremonies, and the first one after a new game starts. */
const NEW_GAME_AWARDS_INTERVAL = 5;

/** The world of a new game: the lot furniture and the layout's placements, on the layout's terrain, with the start date and money, and nobody in it. */
export function newGameSave(layout: StartingLayout, landscape: Landscape | null, start: StartConfig): Save {
  let id = 1000;
  const placed: PlacedAsset[] = LOT_FURNITURE.map((p) => ({ ...p, id: id++ }));
  for (const p of layout.placements) placed.push({ cls: CLASS_OF_KIND[p.kind], id: id++, source: p.name, position: [p.x, p.z, 0], angle: p.angle });
  // the awards clock of a new studio: the previous ceremony is its start date and the first one is the start year plus the interval (orig: `FUN_0085F160` (0x0085F160) sets the previous date to the start time and `FirstAwardsYear` to the rounded year plus the interval, which `AwardSystem_Init` (0x0085ED10) reads from `global.ini`; docs/AUDIO.md)
  const awards = { previousDate: startDate(start.year), firstYear: start.year + NEW_GAME_AWARDS_INTERVAL, gameType: GameType.NewGame };
  return { awards, research: [], people: [], header: { date: startDate(start.year), cash: start.funds }, staff: [], placed, landscape, lotCamera: null };
}
