/**
 * `data\landscape\outsidelot_high.rob` and `outsidelot_low.rob`: the scenery outside the studio lot, as text. One object per line,
 * `[mesh or blueprint name]  [x y z]  [angle]  [scale]`, with every number written as an integer thousandths (`[-164600 2200 0]` is x -164.6, y 2.2).
 * The files hold the lot's visible fence (concrete wall on the front, wood on the sides and back, corner posts), the gate, the road markings, the city's
 * trees, hedges, planters, parked cars, street furniture and the buildings across the road (`p_debug*` meshes, named that way in the game's data).
 * Some lines repeat; `parseRob` drops the repeats.
 */
export interface RobEntry {
  name: string;
  x: number;
  y: number;
  z: number;
  /** Rotation about the vertical axis in radians, counter-clockwise from above. */
  angle: number;
  scale: number;
}

const LINE = /\[([^\]]*)\]\s*\[(-?\d+) (-?\d+) (-?\d+)\]\s*\[(-?\d+)\]\s*\[(-?\d+)\]/g;

export function parseRob(text: string): RobEntry[] {
  const seen = new Set<string>();
  const out: RobEntry[] = [];
  for (const m of text.matchAll(LINE)) {
    const key = m[0].replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: m[1]!,
      x: Number(m[2]) / 1000,
      y: Number(m[3]) / 1000,
      z: Number(m[4]) / 1000,
      angle: Number(m[5]) / 1000,
      scale: Number(m[6]) / 1000,
    });
  }
  return out;
}
