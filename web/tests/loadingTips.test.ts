// The loading screen's tips and the speech-bubble box (docs/LOADING_SCREENS.md).
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { parseLhts } from "../src/formats/Lhts.ts";
import { decodeDds } from "../src/formats/Dds.ts";
import { LOADING_BOX, parseTip, pickTip, tipKeys } from "../src/screens/loadingTips.ts";
import { PAK_DIR, haveGame, pakIndex } from "./helpers.ts";

test("a tip is a heading, a blank line and a body", () => {
  const t = parseTip("K", "Lot Management<br><br>Press the 'M' key.<br>Then <b>click</b>.");
  assert.deepEqual([t.heading, t.body], ["Lot Management", "Press the 'M' key.\nThen click."]);
  assert.deepEqual(parseTip("K", "Just text"), { key: "K", heading: "", body: "Just text" });
});

test("tips are the FRONTEND_SPLASHSCREEN_<n> entries, picked uniformly", () => {
  const strings = new Map([["FRONTEND_SPLASHSCREEN_20", "B<br><br>b"], ["FRONTEND_SPLASHSCREEN_10", "A<br><br>a"], ["FRONTEND_OPTIONS", "Options"]]);
  assert.deepEqual(tipKeys(strings), ["FRONTEND_SPLASHSCREEN_10", "FRONTEND_SPLASHSCREEN_20"]);
  assert.equal(pickTip(strings, () => 0)!.heading, "A");
  assert.equal(pickTip(strings, () => 0.99)!.heading, "B");
  assert.equal(pickTip(new Map()), null);
  assert.equal(pickTip(null), null);
});

function stringsFile(): string | undefined {
  if (!haveGame) return undefined;
  const text = join(dirname(dirname(PAK_DIR)), "Data", "text");
  const alt = join(dirname(PAK_DIR), "text");
  for (const root of [text, alt]) {
    if (!existsSync(root)) continue;
    for (const lang of readdirSync(root)) {
      const f = join(root, lang, "stringdatabase.lhts");
      if (existsSync(f)) return f;
    }
  }
  return undefined;
}

test("the game's database has about 25 tips, each with a heading", { skip: stringsFile() ? false : "string database not found" }, () => {
  const strings = parseLhts(new Uint8Array(readFileSync(stringsFile()!)));
  const keys = tipKeys(strings);
  assert.ok(keys.length >= 20 && keys.length <= 40, `${keys.length} tips`);
  for (const k of keys) {
    const tip = parseTip(k, strings.get(k)!);
    assert.ok(tip.heading.length > 2 && tip.body.length > 10, k);
  }
});

test("the speech-bubble box is where LOADING_BOX says in every picture", { skip: haveGame ? false : "game archives not found (set OTM_PAK_DIR)" }, async () => {
  const pak = await pakIndex();
  const pictures = pak.list("data\\textures\\ui\\loadingscreens\\");
  assert.equal(pictures.length, 17);
  for (const f of pictures) {
    const img = decodeDds(await pak.read(f));
    const at = (fx: number, fy: number) => {
      const o = (Math.floor(fy * img.height) * img.width + Math.floor(fx * img.width)) * 4;
      return [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!];
    };
    const { x, y, width, height } = LOADING_BOX;
    // the box fill (166, 183, 213) just inside each corner and in the middle; just outside the left and bottom edges it is something else
    for (const [fx, fy] of [[x + 0.03, y + 0.05], [x + width - 0.03, y + 0.05], [x + 0.03, y + height - 0.05], [x + width - 0.03, y + height - 0.05], [x + width / 2, y + height / 2]] as const) {
      const c = at(fx, fy);
      assert.ok(Math.abs(c[0]! - 166) < 16 && Math.abs(c[1]! - 183) < 16 && Math.abs(c[2]! - 213) < 16, `${f.entry.name} at ${fx.toFixed(2)},${fy.toFixed(2)}: ${c}`);
    }
  }
});

import { DEFAULT_LOADING_LAYOUT, withOpacity } from "../src/screens/LoadingView.ts";

test("the default layout is the measured box; colours convert for the panel", () => {
  assert.deepEqual(DEFAULT_LOADING_LAYOUT.box, LOADING_BOX);
  assert.equal(DEFAULT_LOADING_LAYOUT.fit, "contain");
  assert.equal(withOpacity("#a6b7d5", 0.5), "rgba(166, 183, 213, 0.5)");
  assert.equal(withOpacity("#000000", 7), "rgba(0, 0, 0, 1)");
});

import { characterFraming, DEFAULT_CHARACTER, PERSON_HEIGHT } from "../src/screens/LoadingCharacterFraming.ts";

test("character framing: the person fills `size` of the picture's height and stands at a quarter or three quarters across", () => {
  const f = characterFraming({ side: "left", size: 0.8, nudgeX: 0, nudgeY: 0 });
  const height = f.halfHeight * 2;
  assert.ok(Math.abs(height - PERSON_HEIGHT / 0.8) < 1e-9);
  // the character stands at x = 0: its position across the picture is 0.5 + (0 - lookX) / height
  assert.ok(Math.abs(0.5 + (0 - f.lookX) / height - 0.25) < 1e-9);
  assert.ok(Math.abs(0.5 + (0 - characterFraming({ side: "right", size: 0.8, nudgeX: 0, nudgeY: 0 }).lookX) / height - 0.75) < 1e-9);
  // the feet (height 0) are 6 % up from the bottom
  const bottom = f.lookY - f.halfHeight;
  assert.ok(Math.abs((0 - bottom) / height - 0.06) < 1e-9);
  assert.equal(DEFAULT_CHARACTER.enabled, false);
});
