// The nine start options and the starting layout (docs/FRONTEND.md, docs/NEW_GAME.md), from the decompile.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Ini } from "../../src/formats/Ini.ts";
import { applySandboxChoices, defaultOptions, defaultSandboxChoices, GameType, Option, OPTION_COUNT, setStartYear, startYear } from "../../src/sim/sandbox/SandboxOptions.ts";
import { parseStartingLayout, startingLayoutName } from "../../src/sim/sandbox/StartingLayout.ts";

test("default options", () => {
  const d = defaultOptions();
  assert.ok(d[Option.StartDecade] === -1 && d[Option.GameType] === 1, "no decade chosen, new game");
  for (const o of [Option.StarsDontMisbehave, Option.BuildingsDontDecay, Option.InstantMovie, Option.Unused, Option.InstantBuild]) assert.equal(d[o], 0);
  assert.ok(d[Option.StuntInjuriesOff] === 0 && d[Option.StuntmenOff] === 0, "with the add-on gate: stunts and injuries on");
  const base = defaultOptions(false);
  assert.ok(base[Option.StuntInjuriesOff] === 1 && base[Option.StuntmenOff] === 1, "without it they are 1.0");
  assert.ok(OPTION_COUNT === 9 && Option.StuntmenOff === 8);
});

test("the sandbox screen's checkboxes", () => {
  const c = defaultSandboxChoices();
  assert.ok(c.buildingsDecay && !c.instantBuild && !c.instantShoot && !c.starsDontMisbehave && !c.stuntmen && !c.stuntInjuries && c.emptyLot);
  const o = defaultOptions();
  applySandboxChoices(o, c);
  assert.equal(o[Option.GameType], 2);
  assert.equal(o[Option.BuildingsDontDecay], 0, "decay on, so option 2 is 0");
  assert.ok(o[Option.StuntmenOff] === 1 && o[Option.StuntInjuriesOff] === 1, "stuntmen and injuries off on the screen: options 8 and 7 are 1.0");
  assert.ok(o[Option.InstantBuild] === 0 && o[Option.InstantMovie] === 0 && o[Option.StarsDontMisbehave] === 0);
  assert.ok(o[Option.StartDecade] === -1 && o[Option.Unused] === 0, "option 0 and the unused one are not touched");
  const all = defaultOptions(false);
  applySandboxChoices(all, { instantBuild: true, instantShoot: true, starsDontMisbehave: true, buildingsDecay: false, stuntmen: true, stuntInjuries: true, emptyLot: true });
  assert.ok(all[Option.InstantBuild] === 1 && all[Option.InstantMovie] === 1 && all[Option.StarsDontMisbehave] === 1 && all[Option.BuildingsDontDecay] === 1);
  assert.ok(all[Option.StuntmenOff] === 0 && all[Option.StuntInjuriesOff] === 0);
});

test("the start year", () => {
  const o = defaultOptions();
  setStartYear(o, 1960);
  assert.ok(o[Option.StartDecade] === 6 && startYear(o) === 1960);
  setStartYear(o, 1967);
  assert.ok(o[Option.StartDecade] === 6 && startYear(o) === 1960, "a year inside a decade rounds down");
  setStartYear(o, 2000);
  assert.equal(o[Option.StartDecade], 10);
  assert.equal(startYear(defaultOptions()), 1890, "the unset value reads as 1890");
});

test("the layout name Campaign_Begin builds", () => {
  assert.equal(startingLayoutName(false, 1960, GameType.NewGame, true).name, "savedefaults/1960");
  assert.ok(!startingLayoutName(false, 1960, GameType.NewGame, true).clearEmptyLotFlag, "the empty-lot flag does not apply to a normal new game");
  assert.equal(startingLayoutName(true, 1960, GameType.Tutorial, false).name, "savedefaults/tutorial");
  assert.equal(startingLayoutName(true, 1990, GameType.Tutorial, true).name, "savedefaults/tutorial");
  assert.deepEqual(startingLayoutName(false, 1960, GameType.Sandbox, true), { name: "savedefaults/1960_clean", clearEmptyLotFlag: true });
  assert.equal(startingLayoutName(false, 1960, GameType.Sandbox, false).name, "savedefaults/1960");
  assert.equal(startingLayoutName(false, 1940, GameType.AddOnQuickStart, true).name, "savedefaults/1940_clean");
  assert.equal(startingLayoutName(false, 2000, GameType.NewGame, false).name, "savedefaults/2000");
});

test("a layout file", () => {
  const sample =
    "\tsize = 2.00\n\n[1.00]\n\tname = facility/facility_preproduction\n\tposition = -31.38, 58.69\n\tangle = 0.00\n\n" +
    "[2.00]\n\tname = facility/trailer_3\n\tposition = 81.34, 93.23\n\tangle = 1.57\n\n" +
    "[3.00]\n\tname = ornament/bench\n\tposition = 5.5, -7.25\n\tangle = 3.14\n\tcityobject = 0\n\n[4.00]\n\tname = set/set_office\n\tposition = 0, 0\n\n[5.00]\n\tposition = 1, 1\n";
  const l = parseStartingLayout(Ini.parse(sample));
  assert.equal(l.size, 2);
  assert.equal(l.year, undefined);
  assert.equal(l.placements.length, 4, "a section without a name is skipped");
  assert.deepEqual(l.placements.map((p) => p.kind), ["facility", "facility", "ornament", "set"]);
  assert.ok(l.placements[1]!.name === "facility/trailer_3" && l.placements[1]!.x === 81.34 && l.placements[1]!.z === 93.23 && l.placements[1]!.angle === 1.57);
  assert.ok(l.placements[0]!.x === -31.38 && l.placements[2]!.z === -7.25);
  assert.equal(l.placements[3]!.angle, 0, "a missing angle is 0");
  assert.ok(l.placements[0]!.cityObject === undefined && l.placements[2]!.cityObject === 0, "cityobject is optional");
  assert.ok(!l.staff.present);
  const clean = parseStartingLayout(Ini.parse("\tsize = 2.00\n\tsize = 2.00\n"));
  assert.ok(clean.size === 2 && clean.placements.length === 0, "a clean file is just a size");
  const y1920 = parseStartingLayout(Ini.parse("\tyear = 1920\n\tsize = 2.00\t\n\n\n"));
  assert.ok(y1920.year === 1920 && y1920.placements.length === 0);
  const staff = parseStartingLayout(Ini.parse("[hired_staff]\n\tbuilders = 2\n\tjanitors = 1\n\tcrew = 3\n\twriters = 4\n[1.00]\n\tname = facility/facility_stage\n\tposition = 1, 2\n"));
  assert.deepEqual(staff.staff, { present: true, builders: 2, janitors: 1, crew: 3, writers: 4 });
  assert.equal(staff.placements.length, 1, "the hired_staff section is not a placement");
});
