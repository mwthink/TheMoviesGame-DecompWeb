import { parseCsv } from "../../formats/Csv.ts";
import { parseNumber } from "../../formats/Ini.ts";

/**
 * Desires (docs/DESIRES.md). A desire has a level between 0 and 1 (its urgency); the rows of `data\rule\desires.csv` say whether it is held constant or grows, how fast and how far.
 * Pure data and arithmetic: no engine or browser API.
 */

/** One row of `desires.csv`; a blank cell is undefined. */
export interface DesireDef {
  name: string;
  /** A desire that stays at this level. */
  fixedDesire?: number;
  /** The level a growing desire cannot pass. */
  maxDesire?: number;
  /** The fraction of the distance to 1 a growing desire climbs on each update. */
  increment?: number;
  fixedUrgency?: number;
}

/** The desire table by name (lower case, trimmed: the file has `rehearse ` with a trailing space). The first row of a repeated name wins (`urgent` is listed twice). */
export function parseDesires(csv: string): Map<string, DesireDef> {
  const rows = parseCsv(csv);
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name);
  const cName = col("name"), cFixed = col("fixeddesire"), cMax = col("maxdesire"), cInc = col("increment"), cUrg = col("fixedurgency");
  const out = new Map<string, DesireDef>();
  for (const r of rows.slice(1)) {
    const name = (r[cName] ?? "").trim().toLowerCase();
    if (!name || out.has(name)) continue;
    out.set(name, {
      name,
      fixedDesire: parseNumber(r[cFixed]),
      maxDesire: parseNumber(r[cMax]),
      increment: parseNumber(r[cInc]),
      fixedUrgency: parseNumber(r[cUrg]),
    });
  }
  return out;
}

/**
 * The starting level range of the desires whose constructors were read (docs/DESIRES.md "Starting level"): [low, high] picks a random level, a single number is that level.
 * `null` = the row's fixed desire. Desires not listed here are not ported yet.
 */
export const STARTING_LEVEL: Record<string, [number, number] | number | null> = {
  crap_male: [0.2, 0.5],
  crap_female: [0.2, 0.5],
  buyfood: [0.15, 0.4],
  propinteract: [0.1, 0.4],
  gawp: 0.4,
  staybybase: null,
};

/**
 * Desires that grow by the base class's tick (`FUN_00837A80`): `level + increment`, linear. Every other ported desire has its own tick of the form `level + (1 - level) * increment`
 * (`DesireCrap_Tick`, `DesireBuyFood_Tick`). `DesirePropInteract` has no tick of its own and uses the base one (its vtable slot `+0x0C`).
 */
const LINEAR_GROWTH = new Set(["propinteract"]);

/** `AdaptiveMultiplier` and `MaxDesireInterval` of `data\desires.ini` (the file also has `AdaptiveDesires = 1`; with 0 every desire would update on every call). */
export const ADAPTIVE_MULTIPLIER = 3;
export const MAX_DESIRE_INTERVAL = 20;

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** A character's desire: a level that grows by the game's rule (`DesireCrap_Tick`, `DesireBuyFood_Tick`). */
export class Desire {
  readonly def: DesireDef;
  /** The level, 0 to 1: the desire's urgency. */
  level: number;
  /** Its place in the urgency-sorted list of the person's desires, 0 = most urgent (`TMCharacter_SortResidentDesires` stores it in the desire's `+0x104`). */
  rank = 0;
  /** Updates left to skip before the next one (`TMBaseDesire_TickShared`, `+0x108`). */
  private countdown = 0;

  constructor(def: DesireDef, random: () => number = Math.random) {
    this.def = def;
    const start = STARTING_LEVEL[def.name];
    if (Array.isArray(start)) this.level = start[0] + random() * (start[1] - start[0]);
    else if (typeof start === "number") this.level = start;
    else this.level = clamp01(def.fixedDesire ?? 0);
  }

  /** The action this desire asks for (the name of its explainer action). */
  get action(): string { return this.def.name; }

  /**
   * One update. A fixed desire does not change; a growing one climbs by `increment` (linear for the base tick, a fraction of the way to 1 for the others) and is capped at `maxDesire`.
   */
  tick(): void {
    const { increment, maxDesire } = this.def;
    if (increment === undefined) return;
    const step = LINEAR_GROWTH.has(this.def.name) ? increment : (1 - this.level) * increment;
    let v = clamp01(this.level + step);
    if (maxDesire !== undefined && v > maxDesire) v = clamp01(maxDesire);
    this.level = v;
  }

  /**
   * One call of `TMBaseDesire_TickShared` (the game makes one per tick, 10 a second): the update itself runs when the countdown reaches 0, and the countdown is then reloaded with the desire's
   * rank times `AdaptiveMultiplier`, at most `MaxDesireInterval`. So the most urgent desire updates every tick, the next every 3, and the least urgent every 20: a desire that is not wanted
   * grows slowly. [read] the mechanism and the two numbers (`data\desires.ini`); [inferred] that the game calls it every tick.
   */
  step(): void {
    this.countdown -= 1;
    if (this.countdown >= 1) return;
    this.tick();
    this.countdown = Math.min(MAX_DESIRE_INTERVAL, this.rank * ADAPTIVE_MULTIPLIER);
  }

  /** A prop's `desire_<name>` slider: add to the level and clamp to 0..1 (`FUN_00842F40`). */
  adjust(delta: number): void { this.level = clamp01(this.level + delta); }

  /** What a finished use does to the desire (`DesireCrap_ResetUrgency`). [guess] the same for every desire here. */
  reset(): void { this.level = 0; }
}
