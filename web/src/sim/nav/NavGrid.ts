/**
 * The walking grid and the pathfinder (docs/MOVEMENT.md).
 *
 * [read] The game's world-to-grid conversion is `WorldToOccupancyGridCoord` (orig 0x0046BFD0): `g = round((world + 256) * 0.5)` on each axis, i.e. cells 2 units wide on a 256 x 256
 * grid whose cell (128, 128) is at the world origin (the same grid as the landscape's path bitmap, `TMLandscape_SetPathCell`, and the placement grid `LotGrid_BlockPathCell`).
 * The game's own pathfinder was not found (the route-following states, `StateEnRoute_Update` orig 0x00429DF0, ask the room's occupant manager for a destination and steer toward it);
 * this one is ours: A* over the cells that are not blocked by a footprint, then straight-line smoothing of the route.
 */

export const NAV_CELL = 2;
export const NAV_SIZE = 256;
const ORIGIN = 256;

export interface Point { x: number; y: number; }

/** The cell a world position falls in, by the game's rounding (round half to even is not needed: the grid is only a coarse guide). */
export function worldToCell(x: number, y: number): { gx: number; gy: number } {
  return { gx: Math.round((x + ORIGIN) * 0.5), gy: Math.round((y + ORIGIN) * 0.5) };
}

/** The world position of a cell's centre (`world = g * 2 - 256`, the inverse of the game's conversion). */
export function cellToWorld(gx: number, gy: number): Point {
  return { x: gx * NAV_CELL - ORIGIN, y: gy * NAV_CELL - ORIGIN };
}

export class NavGrid {
  /** 1 where a cell is blocked (outside the walkable area, or under a footprint). */
  readonly blocked = new Uint8Array(NAV_SIZE * NAV_SIZE).fill(1);

  private idx(gx: number, gy: number): number { return gy * NAV_SIZE + gx; }

  inside(gx: number, gy: number): boolean { return gx >= 0 && gy >= 0 && gx < NAV_SIZE && gy < NAV_SIZE; }

  isBlockedCell(gx: number, gy: number): boolean { return !this.inside(gx, gy) || this.blocked[this.idx(gx, gy)] === 1; }

  isBlocked(x: number, y: number): boolean {
    const c = worldToCell(x, y);
    return this.isBlockedCell(c.gx, c.gy);
  }

  /** Make every cell whose centre is in the rectangle walkable (the lot's area). */
  openRect(minX: number, minY: number, maxX: number, maxY: number): void {
    const a = worldToCell(minX, minY), b = worldToCell(maxX, maxY);
    for (let gy = Math.max(0, a.gy); gy <= Math.min(NAV_SIZE - 1, b.gy); gy++) for (let gx = Math.max(0, a.gx); gx <= Math.min(NAV_SIZE - 1, b.gx); gx++) this.blocked[this.idx(gx, gy)] = 0;
  }

  /**
   * Block the cells a polygon (given as triangles in world coordinates) covers: a cell is blocked when its centre or any of four points half a cell from it lies inside a
   * triangle, so a person of about a unit across cannot clip a corner.
   */
  blockTriangles(tris: [Point, Point, Point][]): void {
    for (const [a, b, c] of tris) {
      const lo = worldToCell(Math.min(a.x, b.x, c.x) - NAV_CELL, Math.min(a.y, b.y, c.y) - NAV_CELL);
      const hi = worldToCell(Math.max(a.x, b.x, c.x) + NAV_CELL, Math.max(a.y, b.y, c.y) + NAV_CELL);
      for (let gy = Math.max(0, lo.gy); gy <= Math.min(NAV_SIZE - 1, hi.gy); gy++) {
        for (let gx = Math.max(0, lo.gx); gx <= Math.min(NAV_SIZE - 1, hi.gx); gx++) {
          if (this.blocked[this.idx(gx, gy)] === 1) continue;
          const p = cellToWorld(gx, gy);
          const h = NAV_CELL / 2;
          if (inTriangle(p.x, p.y, a, b, c) || inTriangle(p.x - h, p.y - h, a, b, c) || inTriangle(p.x + h, p.y - h, a, b, c) || inTriangle(p.x - h, p.y + h, a, b, c) || inTriangle(p.x + h, p.y + h, a, b, c)) this.blocked[this.idx(gx, gy)] = 1;
        }
      }
    }
  }

  /** The nearest walkable cell centre to a point (by rings of cells), or null when nothing within `maxRings` cells is walkable. */
  nearestFree(x: number, y: number, maxRings = 12): Point | null {
    const c = worldToCell(x, y);
    if (!this.isBlockedCell(c.gx, c.gy)) return cellToWorld(c.gx, c.gy);
    for (let r = 1; r <= maxRings; r++) {
      let best: Point | null = null, bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || this.isBlockedCell(c.gx + dx, c.gy + dy)) continue;
          const p = cellToWorld(c.gx + dx, c.gy + dy);
          const d = (p.x - x) ** 2 + (p.y - y) ** 2;
          if (d < bestD) { bestD = d; best = p; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** Whether the straight segment between two world points crosses only walkable cells (sampled every quarter cell). */
  lineClear(a: Point, b: Point): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (NAV_CELL / 4)));
    for (let i = 0; i <= n; i++) if (this.isBlocked(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n)) return false;
    return true;
  }

  /**
   * A route from `from` to `to`, as world points to walk through (not including `from`), or null when there is none. The goal is moved to the nearest walkable cell if it is blocked;
   * a start that is blocked (a person inside a footprint) is moved the same way. A* over 8 neighbours with no corner cutting, then every waypoint that can be skipped by a clear straight line is.
   */
  findPath(from: Point, to: Point, maxNodes = 40000): Point[] | null {
    const s0 = this.nearestFree(from.x, from.y), g0 = this.nearestFree(to.x, to.y);
    if (!s0 || !g0) return null;
    const s = worldToCell(s0.x, s0.y), g = worldToCell(g0.x, g0.y);
    const start = this.idx(s.gx, s.gy), goal = this.idx(g.gx, g.gy);
    const gScore = new Float32Array(NAV_SIZE * NAV_SIZE).fill(Infinity);
    const came = new Int32Array(NAV_SIZE * NAV_SIZE).fill(-1);
    const closed = new Uint8Array(NAV_SIZE * NAV_SIZE);
    const open = new MinHeap();
    gScore[start] = 0;
    open.push(start, octile(s.gx, s.gy, g.gx, g.gy));
    let expanded = 0;
    while (open.size > 0 && expanded++ < maxNodes) {
      const cur = open.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % NAV_SIZE, cy = (cur / NAV_SIZE) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (this.isBlockedCell(nx, ny)) continue;
          if (dx && dy && (this.isBlockedCell(cx + dx, cy) || this.isBlockedCell(cx, cy + dy))) continue; // no cutting a corner
          const n = this.idx(nx, ny);
          if (closed[n]) continue;
          const cost = gScore[cur]! + (dx && dy ? Math.SQRT2 : 1);
          if (cost < gScore[n]!) {
            gScore[n] = cost;
            came[n] = cur;
            open.push(n, cost + octile(nx, ny, g.gx, g.gy));
          }
        }
      }
    }
    if (came[goal] === -1 && goal !== start) return null;
    const cells: Point[] = [];
    for (let c = goal; c !== -1; c = c === start ? -1 : came[c]!) cells.push(cellToWorld(c % NAV_SIZE, (c / NAV_SIZE) | 0));
    cells.reverse();
    // the real start and the real goal replace the cell centres at the ends when the goal is walkable
    const route: Point[] = [from, ...cells.slice(1)];
    if (!this.isBlocked(to.x, to.y)) route[route.length - 1] = to;
    else route.push(g0);
    // straight-line smoothing: from each kept point, jump to the farthest later point it can see
    const out: Point[] = [];
    let at = 0;
    while (at < route.length - 1) {
      let next = route.length - 1;
      while (next > at + 1 && !this.lineClear(route[at]!, route[next]!)) next--;
      out.push(route[next]!);
      at = next;
    }
    return out;
  }
}

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

function inTriangle(px: number, py: number, a: Point, b: Point, c: Point): boolean {
  const d1 = (px - b.x) * (a.y - b.y) - (a.x - b.x) * (py - b.y);
  const d2 = (px - c.x) * (b.y - c.y) - (b.x - c.x) * (py - c.y);
  const d3 = (px - a.x) * (c.y - a.y) - (c.x - a.x) * (py - a.y);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** A small binary min-heap of (item, priority). */
class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size(): number { return this.items.length; }
  push(item: number, p: number): void {
    let i = this.items.length;
    this.items.push(item); this.prio.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent]! <= this.prio[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.items[0]!;
    const last = this.items.pop()!, lastP = this.prio.pop()!;
    if (this.items.length) {
      this.items[0] = last; this.prio[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l]! < this.prio[m]!) m = l;
        if (r < this.items.length && this.prio[r]! < this.prio[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.prio[a], this.prio[b]] = [this.prio[b]!, this.prio[a]!];
  }
}
