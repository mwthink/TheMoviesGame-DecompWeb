import { Ini, parseNumber } from "../../formats/Ini.ts";
import { wrapAngle } from "../anim/Walker.ts";

/**
 * Explainers: what a prop offers a character and where the character stands to use it (docs/DESIRES.md). `data\explainers\<name>.ini` describes one kind of use; a placed object's own ini
 * lists the explainers it carries (`[extra_info/explainer/<name>]`) with a per-object offset. Pure data and arithmetic: no engine or browser API.
 */

/** The weights of the cost of using a prop for one action (`[action/<name>/cost]`). */
export interface CostWeights { distance: number; queue: number; niceness: number; }

export interface ExplainerDef {
  name: string;
  /** The scene played at the prop (`interaction`), if any. */
  interaction?: string;
  /** Whether others may wait their turn. [inferred] true when the key is absent (the file lists a queue scene then). */
  queueable: boolean;
  /** The farthest from the prop a character may be and still choose it. */
  range?: number;
  /** Where the character stands, in the prop's frame, and the heading there (`[pos]`). */
  local: { x: number; y: number; z: number; angle: number };
  /** The actions the prop offers, with their cost weights. An action with no cost section is not offered (`Explainer_GetActionCost`). */
  actions: Map<string, CostWeights>;
  /**
   * What a use does to the person's desires: every `desire_<name>` slider of `[aisliders/...]` by desire name (negative satisfies). The game applies a slider set when the interaction scene
   * fires its event (`TMActivityManager_DispatchAiChannelEvents`), which is not read.
   */
  desireSliders: Map<string, number>;
  /**
   * `typeinterval`, in seconds: after anyone chooses a prop of this kind, no prop of the kind is chosen for this long (a record shared by the whole type, checked in `Explainer_GetActionCost`).
   * [inferred] the file's number is game ticks, 10 to the second.
   */
  typeInterval?: number;
  /** The type's shared state: the game time someone last chose a prop of this kind. */
  readonly type: { chosenAt: number };
}

/** The game ticks 10 times a second (MAIN_LOOP.md). */
const TICKS_PER_SECOND = 10;

function num(ini: Ini, section: string, key: string, fallback: number): number {
  return ini.getNumber(section, key) ?? fallback;
}

/** Parse one explainer file. */
export function parseExplainer(name: string, text: string): ExplainerDef {
  const ini = Ini.parse(text);
  const actions = new Map<string, CostWeights>();
  for (const section of ini.sectionNames()) {
    const m = /^action\/([^/]+)\/cost$/.exec(section);
    if (!m) continue;
    actions.set(m[1]!, { distance: num(ini, section, "distancecost", 0), queue: num(ini, section, "queuecost", 0), niceness: num(ini, section, "nicenesscost", 0) });
  }
  const desireSliders = new Map<string, number>();
  for (const section of ini.sectionNames()) {
    if (!/^aisliders\//.test(section)) continue;
    for (const [key, value] of ini.entries(section)) {
      const v = parseNumber(value);
      if (key.startsWith("desire_") && v !== undefined) desireSliders.set(key.slice(7), (desireSliders.get(key.slice(7)) ?? 0) + v);
    }
  }
  const typeTicks = ini.getNumber("", "typeinterval");
  // the keys sit above the first section; the [pos] block repeats the local position (the game reads LocalPosition* from [pos])
  const queueable = ini.getNumber("", "queueable");
  const range = ini.getNumber("", "range");
  return {
    name: name.toLowerCase(),
    interaction: ini.getString("", "interaction"),
    queueable: queueable === undefined ? true : queueable !== 0,
    range: range !== undefined && range > 0 ? range : undefined,
    local: { x: num(ini, "pos", "localpositionx", 0), y: num(ini, "pos", "localpositiony", 0), z: num(ini, "pos", "localpositionz", 0), angle: wrapAngle(num(ini, "pos", "localangle", 0)) },
    actions,
    desireSliders,
    typeInterval: typeTicks !== undefined && typeTicks > 0 ? typeTicks / TICKS_PER_SECOND : undefined,
    type: { chosenAt: -Infinity },
  };
}

/** What a placed object says about one explainer it carries. */
export interface PlacedExplainerRef { name: string; offset: { x: number; y: number }; angle: number; }

/** Two numbers written "a,b" or "a b". */
function pair(s: string | undefined): { x: number; y: number } {
  const parts = (s ?? "").split(/[\s,]+/).filter(Boolean).map((p) => parseNumber(p));
  return { x: parts[0] ?? 0, y: parts[1] ?? 0 };
}

/** The explainers a placed object's ini carries, in file order (`facility\*.ini`, `ornament\*.ini`, `lot.ini`). */
export function parsePlacedExplainers(text: string): PlacedExplainerRef[] {
  const ini = Ini.parse(text);
  const out: PlacedExplainerRef[] = [];
  for (const section of ini.sectionNames()) {
    const m = /^extra_info\/explainer\/([^/]+)$/.exec(section);
    if (!m) continue;
    out.push({ name: m[1]!, offset: pair(ini.getString(section, "offset")), angle: wrapAngle(ini.getNumber(section, "angle") ?? 0) });
  }
  return out;
}

export interface Pose { x: number; y: number; /** counter-clockwise from above, radians */ yaw: number; }

/**
 * The goal point and heading of an explainer on a placed prop (`FUN_008BC940`): the local position plus the object's offset, turned by the prop's yaw and added to its position (z is
 * ignored). The heading adds the explainer's local angle and the object's angle to the yaw. [inferred] for the heading; the point is read.
 */
export function explainerGoal(def: ExplainerDef, ref: PlacedExplainerRef, prop: Pose): { x: number; y: number; heading: number } {
  const lx = def.local.x + ref.offset.x, ly = def.local.y + ref.offset.y;
  const c = Math.cos(prop.yaw), s = Math.sin(prop.yaw);
  return { x: prop.x + c * lx - s * ly, y: prop.y + s * lx + c * ly, heading: wrapAngle(prop.yaw + def.local.angle + ref.angle) };
}

/** Ticks a prop stays "explained for" after someone chose it (`CAssetActionExplainer_StartAction`: 10), at the game's 10 ticks per second. */
export const EXPLAINED_COOLDOWN = 1;

/** One explainer on one placed prop: where it is, who is using it. */
export class PropExplainer {
  readonly def: ExplainerDef;
  readonly goal: { x: number; y: number; heading: number };
  /** The people using it or heading for it. */
  users = 0;
  /** Someone is at the prop and using it now: the others who came wait (the game's queue, without its queue points). */
  occupied = false;
  /** Game seconds until which it counts as taken (the cooldown after it was chosen). */
  takenUntil = 0;

  constructor(def: ExplainerDef, ref: PlacedExplainerRef, prop: Pose) {
    this.def = def;
    this.goal = explainerGoal(def, ref, prop);
  }

  /** Busy for someone who would not queue: in use, or chosen a moment ago. */
  busy(now: number): boolean { return this.users > 0 || now < this.takenUntil; }

  /** `Explainer_GetActionCost` for a character at (x, y): null when the prop cannot serve them, else the cost to compare. `niceness` is 0..1 (the game's source of it is not read). */
  cost(action: string, x: number, y: number, now: number, niceness = 1): number | null {
    const w = this.def.actions.get(action);
    if (!w) return null;
    const distance = Math.hypot(this.goal.x - x, this.goal.y - y);
    if (this.def.range !== undefined && distance > this.def.range) return null;
    if (!this.def.queueable && this.busy(now)) return null;
    if (this.def.typeInterval !== undefined && now - this.def.type.chosenAt < this.def.typeInterval) return null; // someone chose this kind of prop a moment ago
    // queueable props: the cost grows with the people already there (a queue position), as `queuecost` says
    const queue = this.def.queueable ? this.users : 0;
    return distance * w.distance + queue * w.queue + (1 - niceness) * w.niceness;
  }
}
