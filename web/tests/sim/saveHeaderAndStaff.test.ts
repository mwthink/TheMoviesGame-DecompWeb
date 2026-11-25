// The saved game's header (date, cash) and the player's employees. Needs a Quick Start save (or the fresh one for the empty case).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseSave } from "../../src/formats/Jad.ts";
import { findSave } from "../helpers.ts";

const QUICK = findSave("QUICKSTART");
const FRESH = findSave("FRESH");

test("header: date and cash", { skip: QUICK ? false : "needs a Quick Start save" }, () => {
  const s = parseSave(new Uint8Array(readFileSync(QUICK!)));
  assert.ok(s.header);
  assert.ok(s.header.date > 1900 * 365 && s.header.date < 2000 * 365, `date ${s.header.date}`);
  assert.ok(s.header.cash > 0);
});

test("staff: the player's employees only, with names and a career", { skip: QUICK ? false : "needs a Quick Start save" }, () => {
  const s = parseSave(new Uint8Array(readFileSync(QUICK!)));
  assert.ok(s.staff.length > 5 && s.staff.length < 80, `${s.staff.length} employees`);
  for (const p of s.staff) assert.ok(p.name.length > 0);
  assert.ok(s.staff.some((p) => p.cls === "CStar"));
  assert.ok(s.staff.some((p) => p.cls === "CStaff" && p.career !== ""));
});

test("a fresh studio has no staff", { skip: FRESH ? false : "needs a fresh-studio save" }, () => {
  assert.equal(parseSave(new Uint8Array(readFileSync(FRESH!))).staff.length, 0);
});
