// The expected numbers come from the Python tools (tools/msh_dump.py, tools/dds.py, tools/jad_dump.py, tools/pak_extract.py) run on the same files.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { decodeDds } from "../src/formats/Dds.ts";
import { Ini } from "../src/formats/Ini.ts";
import { parseSave } from "../src/formats/Jad.ts";
import { parseMsh } from "../src/formats/Msh.ts";
import { gameHash } from "../src/assets/hash.ts";
import { haveGame, haveSave, pakIndex, SAVE_PATH } from "./helpers.ts";

const game = { skip: haveGame ? false : "game archives not found (set OTM_PAK_DIR)" };
const save = { skip: haveSave ? false : "saved game not found (set OTM_SAVE)" };

test("gameHash is the game's case-folding string hash", () => {
  assert.equal(gameHash("abc"), gameHash("ABC"));
  assert.equal(gameHash(""), 0);
  assert.equal(gameHash("a"), 0x41); // 'a' & ~0x20
});

test("Ini reads keys before and after sections", () => {
  const ini = Ini.parse("\tmesh = fac_gatehouse.msh\ninitialrotation = 0\n[finance]\n\tpurchasecost = 5;\n");
  assert.equal(ini.get("mesh"), "fac_gatehouse.msh");
  assert.equal(ini.get("Finance/PurchaseCost"), "5");
});

test("pak index finds the patched ini in its directory", game, async () => {
  const pak = await pakIndex();
  const ini = pak.find("facility_gatehouse.ini");
  assert.ok(ini);
  assert.equal(ini.dir, "data\\facility\\");
  assert.match(ini.archive.source.name, /^Addon_/);
  const text = new TextDecoder().decode(await pak.read(ini));
  assert.equal(Ini.parse(text).get("mesh"), "fac_gatehouse.msh");
  const tex = pak.find("land_grass00.dds", { dir: "data\\textures\\" });
  assert.ok(tex);
  assert.equal((await pak.read(tex)).length, 43832);
  // the thumbnail copy lives elsewhere and must not be picked when a directory is asked for
  assert.equal(pak.find("fac_gatehouse.dds", { dir: "data\\textures\\" }), undefined);
});

test("DDS decode matches tools/dds.py", game, async () => {
  const pak = await pakIndex();
  const grass = decodeDds((await pak.readByName("land_grass00.dds", { dir: "data\\textures\\" }))!);
  assert.deepEqual([grass.width, grass.height], [256, 256]);
  assert.deepEqual([...grass.data.subarray(0, 4)], [90, 129, 41, 255]);
  const sum = [0, 0, 0];
  for (let i = 0; i < grass.data.length; i += 4) for (let c = 0; c < 3; c++) sum[c]! += grass.data[i + c]!;
  assert.deepEqual(sum, [4600247, 6456467, 1714204]);

  const side = decodeDds((await pak.readByName("land_sidewalk02.dds", { dir: "data\\textures\\" }))!);
  assert.deepEqual([side.width, side.height], [128, 128]);
  assert.deepEqual([...side.data.subarray(0, 4)], [164, 149, 123, 255]);

  const wall = decodeDds((await pak.readByName("wall_ph50d.dds", { dir: "data\\textures\\" }))!); // DXT3
  assert.deepEqual([...wall.data.subarray(0, 4)], [172, 157, 131, 255]);
  let alpha = 0;
  for (let i = 3; i < wall.data.length; i += 4) alpha += wall.data[i]!;
  assert.equal(alpha, 57574206);
});

test("gatehouse mesh matches tools/msh_dump.py", game, async () => {
  const pak = await pakIndex();
  const msh = parseMsh((await pak.readByName("fac_gatehouse.msh"))!);
  assert.equal(msh.textures.length, 31);
  assert.equal(msh.materials.length, 30);
  assert.equal(msh.primitives.length, 30);
  assert.deepEqual(Object.fromEntries(Object.entries(msh.chunks).map(([k, c]) => [k, [c.verts.length / 3, c.tris.length / 3]])), {
    flag13: [16, 24],
    b15_02: [24, 12],
    b16_01: [25, 19],
  });
  assert.deepEqual(msh.parts.map((p) => [p.name, p.chunk.verts.length / 3]), [["room_", 32], ["room_staff_fire", 8], ["room_staff_hire_janitor", 20], ["room_staff_hire_builder", 4]]);

  let nv = 0, nt = 0;
  const sum = { x: 0, y: 0, z: 0, u: 0, v: 0, l: 0 };
  for (const p of msh.primitives) {
    nv += p.positions.length / 3;
    nt += p.indices.length / 3;
    for (let i = 0; i < p.positions.length / 3; i++) {
      sum.x += p.positions[i * 3]!;
      sum.y += p.positions[i * 3 + 1]!;
      sum.z += p.positions[i * 3 + 2]!;
      sum.u += p.uv[i * 2]!;
      sum.v += p.uv[i * 2 + 1]!;
      if (p.uv2) sum.l += p.uv2[i * 2]! + p.uv2[i * 2 + 1]!;
    }
  }
  assert.equal(nv, 22773);
  assert.equal(nt, 10997);
  const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
  near(sum.x, 12436.38, 1);
  near(sum.y, 23909.06, 1);
  near(sum.z, 122665.72, 5);
  near(sum.u, 13023.39, 1);
  near(sum.v, 11114.632, 1);
  near(sum.l, 18899.47, 1);
});

test("saved game: placed assets and landscape match tools/jad_dump.py", save, async () => {
  const s = parseSave(new Uint8Array(await readFile(SAVE_PATH)));
  assert.deepEqual(s.placed.map((p) => [p.cls, p.id, p.source, p.position.map((x) => Math.round(x * 100) / 100), p.angle]), [
    ["CLot", 1007, "lot", [0, 0, 0], 0],
    ["CSponsoredBillboard", 1008, "ornament/p_billboard", [43.24, 2.47, 0], 0],
    ["CFacility", 1009, "facility/facility_gatehouse", [-28, 10, 0], 0],
  ]);
  const l = s.landscape!;
  assert.ok(l);
  assert.deepEqual(l.textures, ["Land_sand00", "Land_grass00", "Land_grass02", "Land_grass01", "Land_earth00", "Land_tarmac00", "Land_sidewalk02"]);
  let bits = 0;
  for (const b of l.path) for (let k = 0; k < 8; k++) bits += (b >> k) & 1;
  assert.equal(bits, 8897);
  const at = (x: number, y: number) => [...l.cells.subarray((x * 256 + y) * 3, (x * 256 + y) * 3 + 3)];
  assert.deepEqual(at(0, 0), [48, 15, 15]);
  assert.deepEqual(at(128, 128), [52, 53, 15]);
  assert.deepEqual(at(100, 50), [48, 15, 15]);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < l.cells.length; i += 3) {
    s0 += l.cells[i]! & 15;
    s1 += l.cells[i + 1]!;
    s2 += l.cells[i + 2]!;
  }
  assert.deepEqual([s0, s1, s2], [7787, 1342844, 1267290]);
});

test("world data: splat weights and the gatehouse model load from the real files", { ...game, ...save }, async () => {
  const { loadWorldData } = await import("../src/world/WorldData.ts");
  const world = await loadWorldData(await pakIndex(), parseSave(new Uint8Array(await readFile(SAVE_PATH))));
  const t = world.terrain!;
  assert.ok(t);
  assert.equal(t.groundTextures.length, 7);
  assert.ok(t.groundTextures.every((x) => x !== null));
  assert.equal(t.sidewalk, 6);
  for (let i = 0; i < 256 * 256; i++) {
    const sum = t.weightsA[i * 4]! + t.weightsA[i * 4 + 1]! + t.weightsA[i * 4 + 2]! + t.weightsA[i * 4 + 3]! +
      t.weightsB[i * 4]! + t.weightsB[i * 4 + 1]! + t.weightsB[i * 4 + 2]! + t.weightsB[i * 4 + 3]!;
    assert.ok(Math.abs(sum - 255) <= 4, `weights at ${i} sum to ${sum}`);
  }
  assert.equal(t.path.reduce((n, b) => n + (b ? 1 : 0), 0), 8897);
  const gate = world.models.find((m) => m.asset.source === "facility/facility_gatehouse")!;
  assert.ok(gate, `no gatehouse; warnings: ${world.warnings.join("; ")}`);
  assert.ok(gate.textures.has("lm_1940gates_00.dds"));
  console.log("world warnings:", world.warnings);
});
