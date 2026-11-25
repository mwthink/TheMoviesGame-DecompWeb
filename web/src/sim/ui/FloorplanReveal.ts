/**
 * When a building's floor plan (its rooms and their text) is revealed and hidden again, from the game's `data\floorplans\floorplanrevealing.csv` (docs/ROOM_DISPLAY.md).
 *
 * [data] One row per facility and, for each thing the mouse pointer can hold (empty cursor, a staff member, a project ...), three numbers: **Distance (m)**, **Time (secs)** and
 * **Walls Reappear (m)**. [guess] on the column names: the floor plan is revealed when the pointer has been within `distance` of the building for `time` seconds, and the
 * walls come back once the pointer is farther than `reappear`. Example: with an empty cursor the gatehouse reveals after 2 s directly over it (distance 0) and hides at 10 m;
 * with a staff member in hand it reveals at once within 2 m and hides at 7 m. The game reads the file in `CAsset_ShowFloorplanIfNeeded` (orig 0x00534D30) and moves the rooms in
 * with `CAsset_UpdateFloorplanFade` (orig 0x005313E0), which drops each room in after a delay and a short fall.
 */
export interface RevealRule { distance: number; time: number; reappear: number; }

/** facility name -> what the pointer holds -> rule. */
export type RevealRules = Map<string, Map<string, RevealRule>>;

/** The rule when nothing is known about a building: reveal after 2 s over it, hide at 7 m (the commonest empty-cursor row). */
export const DEFAULT_RULE: RevealRule = { distance: 0, time: 2, reappear: 7 };

/** Dev override: reveal at once when the pointer is over the building, hide as soon as it leaves. */
export const ALWAYS_RULE: RevealRule = { distance: 0, time: 0, reappear: 0.5 };

/** Parse the file: two header rows (names of what is held, then the three column names), then one row per facility with three numbers per held thing. */
export function parseFloorplanRevealing(text: string): RevealRules {
  const rows = text.split(/\r?\n/).map((l) => l.split(","));
  const header = rows.find((r) => r[0]?.trim() === "rule_set");
  const out: RevealRules = new Map();
  if (!header) return out;
  const held: { name: string; col: number }[] = [];
  header.forEach((cell, i) => { if (i > 0 && cell.trim()) held.push({ name: cell.trim(), col: i }); });
  for (const r of rows.slice(rows.indexOf(header) + 1)) {
    const key = r[0]?.trim();
    if (!key || key.startsWith("#")) continue;
    const rules = new Map<string, RevealRule>();
    for (const { name, col } of held) {
      const [d, t, w] = [r[col], r[col + 1], r[col + 2]].map((v) => (v === undefined || v.trim() === "" ? NaN : Number(v)));
      if ([d, t, w].every((v) => Number.isFinite(v))) rules.set(name, { distance: d!, time: t!, reappear: w! });
    }
    if (rules.size) out.set(key.toLowerCase(), rules);
  }
  return out;
}

/** The rule for a facility and a held thing ("empty_cursor" is what the web app has today); the default when either is unknown. */
export function revealRule(rules: RevealRules | null, facility: string, held = "empty_cursor"): RevealRule {
  return rules?.get(facility.toLowerCase())?.get(held) ?? DEFAULT_RULE;
}

/** The distance from a point to a polygon given as indexed triangles: 0 inside (or on the edge), else to the nearest triangle edge. Model coordinates (x, y). */
export function distanceToPolygon(chunk: { verts: Float32Array; tris: Uint16Array }, px: number, py: number): number {
  const v = chunk.verts;
  let best = Infinity;
  for (let t = 0; t < chunk.tris.length; t += 3) {
    const a = chunk.tris[t]! * 3, b = chunk.tris[t + 1]! * 3, c = chunk.tris[t + 2]! * 3;
    const ax = v[a]!, ay = v[a + 1]!, bx = v[b]!, by = v[b + 1]!, cx = v[c]!, cy = v[c + 1]!;
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return 0; // inside
    for (const [x0, y0, x1, y1] of [[ax, ay, bx, by], [bx, by, cx, cy], [cx, cy, ax, ay]] as const) {
      const dx = x1 - x0, dy = y1 - y0;
      const len2 = dx * dx + dy * dy;
      const u = len2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(px - (x0 + u * dx), py - (y0 + u * dy)));
    }
  }
  return best;
}

/** One building the pointer might reveal: its key, the rule that applies to it, and how far the pointer is from it on the ground (0 = over it). */
export interface RevealCandidate { key: string; rule: RevealRule; distance: number; }

/**
 * Decides which building's floor plan is showing. Each update gets every building's distance from the pointer. A building becomes the candidate when the pointer is within its
 * rule's `distance`; it is revealed once it has stayed the candidate for the rule's `time`. A revealed building is hidden again when the pointer is farther than its `reappear`
 * distance (and another building's reveal replaces it).
 */
export class RevealTracker {
  /** The building whose floor plan is showing, or null. */
  revealed: string | null = null;
  private candidate: string | null = null;
  private dwell = 0;

  update(dtSeconds: number, buildings: RevealCandidate[]): string | null {
    const shown = this.revealed ? buildings.find((b) => b.key === this.revealed) : undefined;
    if (this.revealed && (!shown || shown.distance > shown.rule.reappear)) this.revealed = null;
    // the nearest building the pointer is close enough to
    let best: RevealCandidate | null = null;
    for (const b of buildings) if (b.distance <= b.rule.distance && (!best || b.distance < best.distance)) best = b;
    if (!best) { this.candidate = null; this.dwell = 0; return this.revealed; }
    if (best.key !== this.candidate) { this.candidate = best.key; this.dwell = 0; }
    this.dwell += dtSeconds;
    if (this.dwell >= best.rule.time) this.revealed = best.key;
    return this.revealed;
  }
}
