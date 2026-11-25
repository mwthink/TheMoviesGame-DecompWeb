// The saved game's header (date, cash) and the player's employees. Needs a Quick Start save (or the fresh one for the empty case).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseSave, parseSaveSummary, SAVE_SUMMARY_BYTES } from "../../src/formats/Jad.ts";
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

test("summary: the header alone, from the first bytes", { skip: QUICK ? false : "needs a Quick Start save" }, () => {
  const bytes = new Uint8Array(readFileSync(QUICK!));
  const sum = parseSaveSummary(bytes.subarray(0, SAVE_SUMMARY_BYTES));
  const full = parseSave(bytes).header!;
  assert.equal(sum.date, full.date);
  assert.equal(sum.cash, full.cash);
  assert.ok(sum.studio.length > 0, "a Quick Start studio has a name");
  assert.ok(sum.savedAt && sum.savedAt.getFullYear() > 2000, `saved at ${sum.savedAt}`);
});

test("summary: a synthetic header", () => {
  const wide = (s: string) => { const b = new Uint8Array(4 + 2 * s.length + 2); new DataView(b.buffer).setUint32(0, 2 * s.length + 2, true); for (let i = 0; i < s.length; i++) b[4 + 2 * i] = s.charCodeAt(i); return b; };
  const prefix = [0x8a, 0xb3, 0x7c, 0x01, 0x04, 0x00, 0x00, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x0a];
  const head = new Uint8Array(8 + 24);
  const v = new DataView(head.buffer);
  v.setFloat32(0, 1960 * 365 + 21, true);
  v.setFloat32(4, 5000, true);
  [9, 30, 3, 25, 11, 2026].forEach((n, i) => v.setUint32(8 + 4 * i, n, true));
  const parts = [Uint8Array.from(prefix), new Uint8Array(4), Uint8Array.from("[HEADER]\n", (c) => c.charCodeAt(0)), head, wide(""), wide("QUICKSTART"), wide("Test Pictures")];
  const d = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { d.set(p, at); at += p.length; }
  const sum = parseSaveSummary(d);
  assert.equal(sum.cash, 5000);
  assert.equal(sum.studio, "Test Pictures");
  assert.equal(sum.state, "QUICKSTART");
  assert.equal(sum.savedAt?.getMonth(), 10);
  assert.throws(() => parseSaveSummary(new Uint8Array(64)), /not a saved game/);
});
