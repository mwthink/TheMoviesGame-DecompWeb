// Room floor labels: the string database reader (checked against tools/lhts.py and the values quoted in docs/SAVE_FORMAT.md) and the room floor centre.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { parseLhts, roomLines } from "../src/formats/Lhts.ts";
import { parseMsh } from "../src/formats/Msh.ts";
import { chunkCentre } from "../src/world/WorldData.ts";
import { haveGame, PAK_DIR, pakIndex } from "./helpers.ts";

const TEXT = join(dirname(PAK_DIR), "text", "EN-UK");

test("room text lines: key, key_2, fire rooms, no key", () => {
  const s = new Map([["ROOM_SS_ACTORS", "A"], ["ROOM_SS_ACTORS_2", "B"], ["ROOM_FIRE_STAFF", "x"], ["ROOM_FIRE_SCRIPT", "y"], ["ROOM_FIRE_WANABE", "z"]]);
  assert.deepEqual(roomLines(s, "room_ss_actors"), ["A", "B"]);
  assert.deepEqual(roomLines(s, "room_ss_fire"), ["x/y/z"]);
  assert.deepEqual(roomLines(s, "room_ss_hall"), []);
});

test("room floor centre is the area-weighted centroid", () => {
  const c = chunkCentre({ verts: new Float32Array([0, 0, 0, 4, 0, 0, 4, 2, 0, 0, 2, 0]), tris: new Uint16Array([0, 1, 2, 0, 2, 3]) });
  assert.ok(Math.abs(c.x - 2) < 1e-6 && Math.abs(c.y - 1) < 1e-6);
});

test("the real string database gives the stage school floor text (docs/SAVE_FORMAT.md: Create / Actor)", { skip: !haveGame }, async () => {
  const s = parseLhts(new Uint8Array(await readFile(join(TEXT, "stringdatabase.lhts"))));
  assert.ok(s.size > 1000, `${s.size} entries`);
  assert.deepEqual(roomLines(s, "room_ss_actors"), ["Create", "Actor"]);
  const parts = parseMsh((await (await pakIndex()).readByName("fac_stageschool.msh"))!).parts.map((p) => p.name);
  assert.ok(parts.includes("room_ss_actors"));
  assert.ok(parts.some((n) => roomLines(s, n).length > 0 && n !== "room_ss_actors"));
});
