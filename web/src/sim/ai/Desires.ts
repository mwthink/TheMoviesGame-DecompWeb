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
  gawp: 0.4,
  staybybase: null,
};

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** A character's desire: a level that grows by the game's rule (`DesireCrap_Tick`, `DesireBuyFood_Tick`). */
export class Desire {
  readonly def: DesireDef;
  /** The level, 0 to 1: the desire's urgency. */
  level: number;

  constructor(def: DesireDef, random: () => number = Math.random) {
    this.def = def;
    const start = STARTING_LEVEL[def.name];
    if (Array.isArray(start)) this.level = start[0] + random() * (start[1] - start[0]);
    else if (typeof start === "number") this.level = start;
    else this.level = clamp01(def.fixedDesire ?? 0);
  }

  /** The action this desire asks for (the name of its explainer action). */
  get action(): string { return this.def.name; }

  /** One update. A fixed desire does not change; a growing one climbs `increment` of the way to 1 and is capped at `maxDesire`. */
  tick(): void {
    const { increment, maxDesire } = this.def;
    if (increment === undefined) return;
    let v = clamp01(this.level + (1 - this.level) * increment);
    if (maxDesire !== undefined && v > maxDesire) v = clamp01(maxDesire);
    this.level = v;
  }

  /** What a finished use does to the desire (`DesireCrap_ResetUrgency`). [guess] the same for every desire here. */
  reset(): void { this.level = 0; }
}
