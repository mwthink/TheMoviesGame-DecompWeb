// People in the world: saved placement, costume files, head choice and morph amounts, the standing pose (docs/PEOPLE.md).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseCos } from "../../src/formats/Cos.ts";
import { parseSave } from "../../src/formats/Jad.ts";
import { ageYears, defaultHeadFor, morphAmounts } from "../../src/sim/character/PersonModel.ts";
import { loadWorldData } from "../../src/world/WorldData.ts";
import { findSave, haveGame, pakIndex } from "../helpers.ts";

const QUICK = findSave("QUICKSTART");
const needs = { skip: QUICK && haveGame ? false : "needs the game archives and a Quick Start save" };

test("default head follows the costume's sex", () => {
  assert.equal(defaultHeadFor("f_cheerleader_1.cos"), "head_f_white_jane.hd");
  assert.equal(defaultHeadFor("m_50s_2.cos"), "head_m_white_joe.hd");
});

test("morph amounts: age from 30 to 70, weight from 60 to 100 kg", () => {
  assert.deepEqual(morphAmounts(25, 60), { age: 0, weight: 0 });
  assert.deepEqual(morphAmounts(70, 100), { age: 1, weight: 1 });
  assert.equal(morphAmounts(50, 80).age, 0.5);
  assert.equal(morphAmounts(50, 80).weight, 0.5);
  assert.equal(ageYears(undefined, 715000), 25);
  assert.equal(ageYears(700000, 700000 + 365 * 40), 40);
});

test("saved people: world positions, costumes, heads", needs, () => {
  const s = parseSave(new Uint8Array(readFileSync(QUICK!)));
  const placed = s.people.filter((p) => p.position[0] !== 0 || p.position[1] !== 0);
  assert.ok(placed.length > 10 && placed.length < s.people.length, `${placed.length} of ${s.people.length} are in the world`);
  assert.ok(placed.every((p) => p.costume?.cos));
  assert.ok(placed.every((p) => p.position[2] >= 0 && p.position[2] < 2), "z is the floor height they stand on (0 on the ground; the ground height is looked up when it is 0)");
  assert.ok(placed.every((p) => Math.abs(p.angle) <= Math.PI + 1e-3));
  assert.ok(s.people.some((p) => p.cls === "CStar" && p.head.endsWith(".hd")));
});

test("a costume file names its body mesh", needs, async () => {
  const pak = await pakIndex();
  const cos = parseCos((await pak.readByName("m_50s_2.cos"))!);
  assert.match(cos.body, /\.msh$/i);
  assert.ok(cos.textures.length > 0);
});

test("world data has a model for every placed person, standing upright with arms down", needs, async () => {
  const world = await loadWorldData(await pakIndex(), parseSave(new Uint8Array(readFileSync(QUICK!))));
  assert.ok(world.people.length > 10);
  for (const entry of world.people) {
    let minZ = Infinity, maxZ = -Infinity, maxX = 0;
    for (const part of entry.parts) {
      for (let i = 0; i < part.positions.length; i += 3) {
        minZ = Math.min(minZ, part.positions[i + 2]!); maxZ = Math.max(maxZ, part.positions[i + 2]!);
        maxX = Math.max(maxX, Math.abs(part.positions[i]!));
      }
      if (part.texture) assert.ok(entry.textures.has(part.texture.toLowerCase()), `${entry.person.name}: texture ${part.texture}`);
    }
    assert.ok(minZ > -0.2 && minZ < 0.2, `${entry.person.name}: feet at ${minZ}`);
    assert.ok(maxZ > 1.4 && maxZ < 2.3, `${entry.person.name}: height ${maxZ}`);
    assert.ok(maxX < 0.6, `${entry.person.name}: arms out to ${maxX}`);
  }
});
