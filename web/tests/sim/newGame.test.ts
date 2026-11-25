// A new game's starting world (docs/NEW_GAME.md): the layout and terrain of the start year, as a Save the world loader draws.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ini } from "../../src/formats/Ini.ts";
import { parseSave } from "../../src/formats/Jad.ts";
import { Option } from "../../src/sim/sandbox/SandboxOptions.ts";
import { newGameLayoutName, newGameOptions, newGameSave, parseStartConfig, startDate } from "../../src/sim/sandbox/NewGame.ts";
import { parseStartingLayout } from "../../src/sim/sandbox/StartingLayout.ts";
import { findSave, haveGame, pakIndex } from "../helpers.ts";
import { loadNewGameWorld } from "../../src/world/NewGameWorld.ts";

test("start config: year and money from global.ini", () => {
  assert.deepEqual(parseStartConfig(Ini.parse("[studio]\n\tstartfunds = 150000\n[time]\n\tstart = 1920,20\n")), { year: 1920, funds: 150000 });
  assert.deepEqual(parseStartConfig(Ini.parse("")), { year: 1920, funds: 150000 }, "defaults when the file lacks them");
});

test("start date and layout name", () => {
  assert.equal(startDate(1920), 700800);
  assert.equal(newGameLayoutName(1920), "savedefaults/1920");
  const o = newGameOptions(1960);
  assert.ok(o[Option.GameType] === 1 && o[Option.StartDecade] === 6);
});

test("a built layout's placements follow the lot furniture", () => {
  const layout = parseStartingLayout(Ini.parse("size = 2.00\n[1.00]\n\tname = facility/facility_stage\n\tposition = 54.02, 59.38\n\tangle = 1.5\n[2.00]\n\tname = ornament/p_hedge\n\tposition = 1, 2\n"));
  const save = newGameSave(layout, null, { year: 1930, funds: 5 });
  assert.deepEqual(save.placed.map((p) => p.source), ["lot", "ornament/p_billboard", "facility/facility_gatehouse", "facility/facility_stage", "ornament/p_hedge"]);
  assert.deepEqual(save.placed[3]!.position, [54.02, 59.38, 0]);
  assert.equal(save.placed[3]!.cls, "CFacility");
  assert.equal(new Set(save.placed.map((p) => p.id)).size, 5, "ids are distinct");
  assert.deepEqual(save.header, { date: 1930 * 365, cash: 5 });
  assert.ok(save.people.length === 0 && save.staff.length === 0);
});

const fresh = haveGame ? findSave("FRESH") : undefined;
test("the 1920 new game matches the fresh-studio save", { skip: fresh ? false : "needs the game archives and the fresh-studio save" }, async () => {
  const pak = await pakIndex();
  const world = await loadNewGameWorld(pak, { studioName: "S", ownerName: "O" });
  const save = parseSave(new Uint8Array(readFileSync(fresh!)));
  assert.deepEqual(world.header, save.header);
  assert.equal(world.placements.filter((p) => !p.asset.cls.startsWith("Lot")).length, save.placed.filter((p) => p.cls !== "CLot").length, "the same placed objects");
  assert.equal(world.people.length, 0);
  assert.ok(world.terrain && world.terrain.groundTextures.length >= 7);
});

test("the shipped 1920 terrain is the fresh save's", { skip: fresh ? false : "needs the game archives and the fresh-studio save" }, async () => {
  const { parseLandscapeFile } = await import("../../src/formats/Jad.ts");
  const pak = await pakIndex();
  const lnd = await pak.readByName("1920.lnd", { dir: "data\\savedefaults\\" });
  assert.ok(lnd);
  const land = parseLandscapeFile(lnd)!;
  const saved = parseSave(new Uint8Array(readFileSync(fresh!))).landscape!;
  assert.deepEqual(land.textures, saved.textures);
  assert.deepEqual(land.path, saved.path);
  // [measured] 7 of the 65,536 vertices differ from the studio saved after the tutorial: the shipped file is the game's pristine start, the save has been played on
  let different = 0;
  for (let i = 0; i < land.cells.length; i += 3) if (land.cells[i] !== saved.cells[i] || land.cells[i + 1] !== saved.cells[i + 1] || land.cells[i + 2] !== saved.cells[i + 2]) different++;
  assert.ok(different <= 16, `${different} vertices differ`);
});
