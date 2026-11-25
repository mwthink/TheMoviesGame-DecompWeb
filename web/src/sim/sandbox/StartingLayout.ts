// The starting studio of a new game: which layout file is loaded and what is in it.
//
// From Campaign_Begin (0x004AF870: builds savedefaults/<year or tutorial>[_clean] and passes it to Game_ConstructSystems), Lot_LoadStartingLayout
// (0x0046A780: an empty name means "lots/basic_lot"; loads <name> and "data/<name>.lnd", the terrain), Lot_LoadLayoutFile (0x0046BAB0),
// Lot_PlaceAssetsFromProperties (0x0046AF20: sections named facility/, set or ornament/; keys position, angle, cityobject) and Lot_HireStartingStaff
// (0x0046AB70: the "hired_staff" section). The files are in the archives (data\savedefaults\, data\lots\); docs/NEW_GAME.md has what is in them.
// Not compared with the running game.
import { Ini, parseNumber } from "../../formats/Ini.ts";
import { GameType } from "./SandboxOptions.ts";

export interface LayoutName {
  /** e.g. "savedefaults/1960", "savedefaults/1960_clean", "savedefaults/tutorial" */
  name: string;
  /** Campaign_Begin sets DAT_0104DE24 back to 0 after using it */
  clearEmptyLotFlag: boolean;
}

/**
 * "savedefaults/" + ("tutorial" for the tutorial, else the start year printed with %d), then "_clean" when the empty-lot flag (DAT_0104DE24) is set and
 * the game type is sandbox (2) or add-on quick start (3). The year is not rounded here: the files exist per decade (1900, 1910, ..., 2000), so the caller
 * passes a decade year, as the profile screen does. orig: 0x004AF870
 */
export function startingLayoutName(tutorial: boolean, startYear: number, type: GameType, emptyLotFlag: boolean): LayoutName {
  let name = "savedefaults/" + (tutorial ? "tutorial" : String(startYear));
  const clean = emptyLotFlag && (type === GameType.Sandbox || type === GameType.AddOnQuickStart);
  if (clean) name += "_clean";
  return { name, clearEmptyLotFlag: clean };
}

export type PlacedKind = "facility" | "set" | "ornament" | "other";

export interface LayoutPlacement {
  /** "1.00", "2.00", ... */
  section: string;
  /** e.g. facility/facility_stage */
  name: string;
  kind: PlacedKind;
  /** "position = x, z" */
  x: number;
  z: number;
  /** radians */
  angle: number;
  /** the optional "cityobject" key */
  cityObject?: number;
}

export interface HiredStaff {
  present: boolean;
  builders: number;
  janitors: number;
  crew: number;
  writers: number;
}

export interface StartingLayout {
  /** "size = 2.00" before the first section (a lot size tier, CLot_ApplySizeTier) */
  size?: number;
  /** "year = 1920" appears in a few files */
  year?: number;
  placements: LayoutPlacement[];
  /** present only in some files (data/movielot.ini) */
  staff: HiredStaff;
}

/** By prefix: "facility/", "set/", "ornament/". */
export function kindOfName(name: string): PlacedKind {
  const lower = name.toLowerCase();
  if (lower.startsWith("facility/")) return "facility";
  if (lower.startsWith("set/")) return "set";
  if (lower.startsWith("ornament/")) return "ornament";
  return "other";
}

const int = (s: string | undefined) => {
  const v = parseNumber(s);
  return v !== undefined && Number.isInteger(v) ? v : undefined;
};

/** Sections without a name key, and the hired_staff section, are not placements. orig: 0x0046AF20  orig: 0x0046AB70 */
export function parseStartingLayout(ini: Ini): StartingLayout {
  const out: StartingLayout = { placements: [], staff: { present: false, builders: 0, janitors: 0, crew: 0, writers: 0 } };
  const size = ini.getNumber("", "size");
  if (size !== undefined) out.size = size;
  const year = int(ini.getString("", "year"));
  if (year !== undefined) out.year = year;
  for (const section of ini.sectionNames()) {
    if (!section) continue;
    if (section === "hired_staff") {
      const n = (k: string) => int(ini.getString(section, k)) ?? 0;
      out.staff = { present: true, builders: n("builders"), janitors: n("janitors"), crew: n("crew"), writers: n("writers") };
      continue;
    }
    const name = ini.getString(section, "name");
    if (name === undefined) continue; // not a placement
    const p: LayoutPlacement = { section, name, kind: kindOfName(name), x: 0, z: 0, angle: ini.getNumber(section, "angle") ?? 0 };
    const parts = ini.getString(section, "position")?.split(",");
    if (parts?.length === 2) {
      const [x, z] = parts.map(parseNumber);
      if (x !== undefined && z !== undefined) [p.x, p.z] = [x, z];
    }
    const city = int(ini.getString(section, "cityobject"));
    if (city !== undefined) p.cityObject = city;
    out.placements.push(p);
  }
  return out;
}
