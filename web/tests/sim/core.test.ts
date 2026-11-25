// The ini and csv readers on small inline samples (no game files needed).
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsv } from "../../src/formats/Csv.ts";
import { Ini, parseNumber } from "../../src/formats/Ini.ts";

test("numbers", () => {
  assert.equal(parseNumber(" 1.5 "), 1.5);
  assert.equal(parseNumber("-0.4"), -0.4);
  assert.equal(parseNumber("1e-5"), 1e-5);
  assert.equal(parseNumber("70000"), 70000);
  for (const bad of ["", "abc", "1.5x", undefined]) assert.equal(parseNumber(bad), undefined);
});

test("ini: sections, case, comments, duplicates, bare lines", () => {
  const text =
    "﻿# comment\r\ntop = 1\r\n\r\n[Min_Max]\r\n\tstar_mood_min = 0.8\r\n      indented_key = 2\r\nSTAR_MOOD_MAX=1.2\r\n\r\n" +
    "[global]\nDebutAwardRotateInterval = 6000;\nname = some text with spaces  \nempty =\ndup = 1\ndup = 2\n[min_max]\nextra = 7\n" +
    "[ranking]\nACHIEVEMENT_ONE\nACHIEVEMENT_TWO\n# another comment\n";
  const ini = Ini.parse(text);
  assert.equal(ini.getNumber("", "top"), 1); // keys before the first section
  assert.equal(ini.get("top"), "1");
  assert.equal(ini.getNumber("min_max", "star_mood_min"), 0.8);
  assert.equal(ini.getNumber("MIN_MAX", "Star_Mood_Max"), 1.2); // names are case-insensitive
  assert.equal(ini.get("min_max/indented_key"), "2");
  assert.equal(ini.getNumber("min_max", "extra"), 7); // a repeated section is merged
  assert.equal(ini.getNumber("global", "debutawardrotateinterval"), 6000); // trailing ';' dropped
  assert.equal(ini.getString("global", "name"), "some text with spaces");
  assert.equal(ini.getString("global", "empty"), "");
  assert.equal(ini.getNumber("global", "empty"), undefined); // empty is not a number
  assert.equal(ini.getNumber("global", "dup"), 2); // the last duplicate wins
  assert.ok(!ini.has("global", "missing"));
  assert.ok(!ini.hasSection("nope"));
  assert.equal(ini.getString("nope", "x"), undefined);
  assert.deepEqual(ini.bareLines("ranking"), ["ACHIEVEMENT_ONE", "ACHIEVEMENT_TWO"]);
  assert.deepEqual(ini.sectionNames(), ["", "min_max", "global", "ranking"]);
  assert.equal(ini.entries("min_max").length, 4);
  assert.equal(ini.entries("min_max")[0]![0], "star_mood_min"); // file order, lower-cased keys
  assert.ok(!Ini.parse("[only]\nk = 1\n").hasSection("")); // no "" section when nothing precedes the first one
  assert.deepEqual(Ini.parse("").sectionNames(), []);
  assert.equal(Ini.parse("[a/b]\nk = 3\n").get("a/b/k"), "3"); // a section name with a slash
});

test("csv", () => {
  const rows = parseCsv('[constants],,,\r\nhalflife,4,,\r\n\r\n"a,b","say ""hi""",x\r\nlast,row');
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], ["[constants]", "", "", ""]);
  assert.deepEqual(rows[1]!.slice(0, 2), ["halflife", "4"]);
  assert.deepEqual(rows[2], []); // a blank line keeps the row numbers
  assert.deepEqual(rows[3], ["a,b", 'say "hi"', "x"]);
  assert.deepEqual(rows[4], ["last", "row"]); // no trailing newline
  assert.deepEqual(parseCsv(""), []);
  assert.equal(parseCsv("a,\n")[0]!.length, 2); // a trailing comma is an empty last field
});
