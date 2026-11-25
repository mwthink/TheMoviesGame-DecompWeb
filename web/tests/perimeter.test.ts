// Hand-checked against the disassembly of CLot_BuildPerimeterWallAndGate (0x469290) for the default tier (300 x 224); see src/world/Perimeter.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { lotSize, perimeterPieces } from "../src/world/Perimeter.ts";

test("lot.ini's tier sizes are snapped to the wall grid", () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.01, `${a} vs ${b}`);
  const t2 = lotSize(300, 224);
  near(t2.width, 313.35);
  near(t2.depth, 220);
  near(lotSize(192, 128).width, 193.35);
  near(lotSize(256, 192).width, 253.35);
});

test("perimeter of the tier 2 lot (313.35 x 220)", () => {
  const { width, depth } = lotSize(300, 224);
  const p = perimeterPieces(width, depth);
  const walls = p.filter((x) => x.kind === "wall");
  assert.equal(walls.length, 50);
  assert.equal(p.filter((x) => x.kind === "corner").length, 1);
  assert.deepEqual(p.filter((x) => x.kind === "gate").map((g) => [g.x, g.y]), [[0, 0]]);

  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.01, `${a} vs ${b}`);
  // front wall: 6 segments left of the gate's left end, 6 right of its right end
  [-64.6, -84.6, -104.6, -124.6, -144.6, -164.6].forEach((x, i) => near(walls[i]!.x, x));
  [28.75, 48.75, 68.75, 88.75, 108.75, 128.75].forEach((x, i) => near(walls[6 + i]!.x, x));
  // side walls: 11 a side, turned a quarter turn, from y = 2.2 up in steps of 20
  const sides = walls.filter((w) => w.angle > 0);
  assert.equal(sides.length, 22);
  assert.deepEqual([...new Set(sides.map((w) => Math.round(w.x * 100) / 100))].sort((a, b) => a - b), [-164.6, 148.75]);
  near(Math.max(...sides.map((w) => w.y)), 202.2);
  // corner post at the far right, back wall at y = 222.2 closing the gap between its two halves
  const corner = p.find((x) => x.kind === "corner")!;
  near(corner.x, 148.75);
  near(corner.y, 222.2);
  const back = walls.filter((w) => w.angle === 0 && w.y > 200);
  assert.equal(back.length, 16);
  near(Math.min(...back.map((w) => w.x)), -164.6);
  near(Math.max(...back.map((w) => w.x)), 128.75);
  // the fence's inner width equals the tier's width: left post at -164.6, right post at 148.75
  near(148.75 - -164.6, width);
});

test("a smaller lot has a shorter fence", () => {
  const small = perimeterPieces(lotSize(192, 128).width, lotSize(192, 128).depth);
  const big = perimeterPieces(lotSize(300, 224).width, lotSize(300, 224).depth);
  assert.ok(small.length < big.length);
  assert.ok(small.some((p) => p.kind === "corner") && small.some((p) => p.kind === "gate"));
});
