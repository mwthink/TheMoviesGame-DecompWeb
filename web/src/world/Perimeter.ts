/**
 * The lot's perimeter fence: wall segments, one corner post and the gate, placed when the lot's size tier is applied.
 * Port of `CLot_BuildPerimeterWallAndGate` (0x469290): the decompile loses the arguments, so the arithmetic comes from the disassembly (docs/WEB.md).
 *
 * The lot is `width` x `depth`: lot.ini's `[size]` entry for the tier (tier 2 = 300,224), adjusted by `lotSize` below. The gate sits at the lot's origin. Two anchors mark the ends of the gate's
 * own wall stubs: A on its left and B on its right. They are the defaults the CLot constructor stores (0x468f2d: A = (-44.6, 2.2), B = (28.75, 2.2));
 * lot_gate.msh spans x -45.7 .. 28.4, so they are where the gate mesh ends. From there:
 *   - front wall: walls to the left of A and to the right of B, 20 units each, until the lot is wide enough (half the count on the left);
 *   - side walls: along y from the anchors' y, rotated a quarter turn, `round((depth + 0.5) / 20)` each;
 *   - one corner post at the far right-hand corner;
 *   - back wall: from both ends towards the middle, then a filler piece if the halves do not meet.
 * A wall segment is 20 units long with its origin at its left end (lot_wall_concrete.msh spans x 0 .. 20); the corner is a post at its origin.
 */
export interface PerimeterPiece {
  kind: "wall" | "corner" | "gate";
  /** Lot-local ground position (x, y) and rotation about the vertical axis, counter-clockwise from above. */
  x: number;
  y: number;
  angle: number;
}

export const WALL_LENGTH = 20;
/** The constructor's defaults, as float32 (0xc2326666, 0x400ccccd, 0x41e60000). */
export const GATE_LEFT = { x: Math.fround(-44.6), y: Math.fround(2.2) };
export const GATE_RIGHT = { x: Math.fround(28.75), y: Math.fround(2.2) };

/** The x87 default: round to nearest, ties to even (what CRT_RoundToInt64 does). */
function roundHalfEven(v: number): number {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

const f = Math.fround;

/**
 * The size the game actually uses for a size tier (`CLot_LoadSizeTiers`, 0x4675f0, from its disassembly): the ini's numbers are snapped to the 20-unit
 * wall grid. The width is the gate gap plus a whole number of segments, `(round(w + 0.5) / 20 - round(gap + 0.5) / 20) * 20 + gap` (integer divisions),
 * the depth `round(d + 0.5) / 20 * 20`. For tier 2 that is 313.35 x 220, not 300 x 224. Checked against the buildings of a Quick Start save: they
 * span x -162.1 .. 145.9, and the fence this gives spans -164.6 .. 148.75.
 */
export function lotSize(iniWidth: number, iniDepth: number, a = GATE_LEFT, b = GATE_RIGHT): { width: number; depth: number } {
  const gap = f(b.x - a.x);
  const cells = (v: number) => Math.trunc(roundHalfEven(f(v + 0.5)) / WALL_LENGTH);
  return { width: f(f((cells(iniWidth) - cells(gap)) * WALL_LENGTH) + gap), depth: f(cells(iniDepth) * WALL_LENGTH) };
}

export function perimeterPieces(width: number, depth: number, a = GATE_LEFT, b = GATE_RIGHT): PerimeterPiece[] {
  const out: PerimeterPiece[] = [];
  const wall = (x: number, y: number, angle: number) => out.push({ kind: "wall", x, y, angle });

  const across = roundHalfEven(f(f(f(width - f(b.x - a.x)) + 0.5) * 0.05)); // segments across the front, not counting the gate
  const left = across >> 1;
  let ax = a.x, ay = a.y;
  let bx = b.x, by = b.y;
  for (let i = 0; i < left; i++) {
    ax = f(ax - WALL_LENGTH);
    wall(ax, ay, 0);
  }
  for (let i = 0; i < across - left; i++) {
    wall(bx, by, 0);
    bx = f(bx + WALL_LENGTH);
  }
  const along = roundHalfEven(f(f(depth + 0.5) * 0.05));
  for (let i = 0; i < along; i++) {
    wall(ax, ay, Math.PI / 2);
    wall(bx, by, Math.PI / 2);
    ay = f(ay + WALL_LENGTH);
    by = f(by + WALL_LENGTH);
  }
  out.push({ kind: "corner", x: bx, y: by, angle: 0 });
  const back = roundHalfEven(f(f(width + 0.5) * 0.05)) >> 1;
  for (let i = 0; i < back; i++) {
    wall(ax, ay, 0);
    ax = f(ax + WALL_LENGTH);
    bx = f(bx - WALL_LENGTH);
    wall(bx, by, 0);
  }
  while (f(ax - bx) < 0) {
    wall(ax, ay, 0);
    ax = f(ax + WALL_LENGTH);
  }
  out.push({ kind: "gate", x: 0, y: 0, angle: 0 });
  return out;
}

/**
 * The rectangle the gameplay camera is kept inside, `CLot_ComputeWorldBoundsFromTier` (0x467260, from its disassembly):
 * minX = lot.x + A.x - trunc(n / 2) * 20 with n = trunc((width - (B.x - A.x) + 0.5) * 0.05) (the fence's front-wall segments), maxX = minX + width,
 * minY = lot.y + 2.0, maxY = minY + depth. For the tier 2 lot at the origin: x -164.6 .. 148.75, y 2 .. 222.
 */
export interface LotBounds { minX: number; minY: number; maxX: number; maxY: number }
export function lotBounds(width: number, depth: number, origin: [number, number] = [0, 0], a = GATE_LEFT, b = GATE_RIGHT): LotBounds {
  const n = Math.trunc(f(f(f(width - f(b.x - a.x)) + 0.5) * 0.05));
  const minX = f(f(origin[0] + a.x) - f(Math.trunc(n / 2) * WALL_LENGTH));
  const minY = f(origin[1] + 2);
  return { minX, minY, maxX: f(minX + width), maxY: f(minY + depth) };
}
