// The command-line parser and the intro sequence (docs/BOOT.md), from the decompile.
import assert from "node:assert/strict";
import { test } from "node:test";
import { getSwitch, parseLaunchOptions } from "../../src/sim/boot/CommandLine.ts";
import { chooseBootPath, classifyPumpMessage, IntroSequence, IntroState, makeIntroConfig, nextAfterIntro, type Presentation } from "../../src/sim/boot/IntroSequence.ts";

const is = (line: string, key: string, found: boolean, value: string, max?: number) => assert.deepEqual(getSwitch(line, key, max), { found, value }, `${JSON.stringify(line)} ${key}`);

// read through a function so TypeScript does not keep a narrowed type across calls that change it
const stateOf = (x: { state: number }): number => x.state;

test("getSwitch, with the original's quirks", () => {
  is("", "reenter", false, "");
  is("-reenter", "reenter", true, "");
  is("-download movie.mov", "download", true, "movie.mov");
  is("-download a b", "download", true, "a"); // the value stops at a space
  is("-download    spaced", "download", true, "spaced");
  is("-reenterx", "reenter", false, ""); // not a prefix match
  is("-xreenter", "reenter", false, ""); // not a suffix match
  is("-Reenter", "reenter", false, ""); // case-sensitive
  is("reenter", "reenter", false, ""); // no dash, no switch
  is("-   reenter", "reenter", true, ""); // spaces after the dash are skipped
  is("a-reenter", "reenter", true, ""); // a dash inside a word starts a switch
  is("-editor -download x -reenter", "reenter", true, "");
  is("-reenter -", "reenter", true, "-"); // a trailing dash is the value of the switch before it
  is("-reenter -", "editor", false, "");
  is("-", "reenter", false, "");
  // the value is the next token even if it looks like a switch, but each call scans from the start on its own
  is("-download -editor", "download", true, "-editor");
  is("-download -editor", "editor", true, "");
  // several matches: found stays true, the last value wins, a later match without a value clears it
  is("-download a -download b", "download", true, "b");
  is("-download a -download", "download", true, "");
  is("-download a -other", "download", true, "a");
  // the value is capped (100 in the game), cut mid-token; the rest is scanned as ordinary characters
  is("-download " + "x".repeat(150), "download", true, "x".repeat(100));
  is("-download abcdef", "download", true, "abc", 3);
  is("-download abc-reenter", "download", true, "abc", 3);
  is("-download abcdef-reenter", "reenter", true, "", 3);
  is("-reenter\0-editor", "editor", false, ""); // an embedded NUL ends the line
});

test("the four switches the game reads", () => {
  assert.deepEqual(parseLaunchOptions(""), { safeMode: false, reenter: false, editor: false, download: false, downloadValue: "" });
  const a = parseLaunchOptions("-safemode -reenter");
  assert.ok(a.safeMode && a.reenter && !a.editor && !a.download);
  const b = parseLaunchOptions("-editor -download saved.tmm");
  assert.ok(b.editor && b.download && b.downloadValue === "saved.tmm" && !b.reenter);
  const c = parseLaunchOptions("-download");
  assert.ok(c.download && c.downloadValue === "");
  const d = parseLaunchOptions("-download -editor");
  assert.ok(d.download && d.downloadValue === "-editor" && d.editor, "download swallows the next token but editor is still seen");
});

const shows = (s: IntroSequence, kind: Presentation["kind"], path: string | null) => {
  const p = s.current();
  return p.kind === kind && p.path === path;
};

test("low tier (image mode), first launch: every splash runs its full time; only Lionhead and Activision are skippable", () => {
  const s = new IntroSequence(makeIntroConfig(0, 1, false));
  assert.equal(stateOf(s), IntroState.Start);
  assert.ok(!s.update({ nowMs: 1000 }));
  assert.ok(stateOf(s) === IntroState.Lionhead && shows(s, "image", "ui/lionhead_splash.dds"));
  s.update({ nowMs: 3999 });
  assert.equal(stateOf(s), IntroState.Lionhead, "holds before 3 s");
  s.update({ nowMs: 4000 });
  assert.ok(stateOf(s) === IntroState.Activision && shows(s, "image", "ui/activision_screen.dds"));
  s.requestSkip();
  s.update({ nowMs: 4000 });
  assert.ok(stateOf(s) === IntroState.Intel && shows(s, "image", "ui/intel_splash.dds"), "skip works on Activision");
  s.requestSkip();
  s.update({ nowMs: 4000 });
  assert.equal(stateOf(s), IntroState.Intel, "skip ignored on Intel, first launch");
  s.update({ nowMs: 7000 });
  assert.ok(stateOf(s) === IntroState.Ati && shows(s, "image", "ui/ati_splash.dds"));
  s.update({ nowMs: 7001 });
  assert.equal(stateOf(s), IntroState.Ati, "the skip requested during Intel was cleared by the transition");
  assert.ok(s.update({ nowMs: 10000 }) && s.done && shows(s, "none", null));
});

test("second launch: the vendor splashes become skippable", () => {
  const s = new IntroSequence(makeIntroConfig(0, 2, false));
  s.update({ nowMs: 0 }); // -> lionhead
  for (let i = 0; i < 3; i++) {
    s.requestSkip();
    s.update({ nowMs: 0 });
  } // -> activision -> intel -> ati
  assert.equal(stateOf(s), IntroState.Ati);
  s.requestSkip();
  assert.ok(s.update({ nowMs: 0 }));
});

test("higher tier: the animated logo and the video, driven by the platform's signals", () => {
  const s = new IntroSequence(makeIntroConfig(2, 5, false));
  s.update({ nowMs: 500 });
  assert.ok(stateOf(s) === IntroState.Lionhead && shows(s, "logoScreen", null));
  s.update({ nowMs: 600000 });
  assert.equal(stateOf(s), IntroState.Lionhead, "the logo screen ignores the clock");
  s.requestSkip();
  s.update({ nowMs: 600000 });
  assert.equal(stateOf(s), IntroState.Lionhead, "and skip");
  s.update({ nowMs: 600000, logoScreenDone: true });
  assert.ok(stateOf(s) === IntroState.Activision && shows(s, "movie", "data/intro/atvi_logo.wmv"));
  assert.ok(!s.wantsMovieSkip);
  s.requestSkip();
  assert.ok(s.wantsMovieSkip && stateOf(s) === IntroState.Activision, "skip asks the movie to stop");
  s.update({ nowMs: 600000, logoScreenDone: true });
  assert.equal(stateOf(s), IntroState.Activision, "the movie must report done");
  s.update({ nowMs: 600000, logoScreenDone: true, movieDone: true });
  assert.ok(stateOf(s) === IntroState.Intel && !s.wantsMovieSkip);
});

test("the Chinese legal notice first: 12 s (skippable), then the normal sequence", () => {
  const s = new IntroSequence(makeIntroConfig(0, 1, true));
  s.update({ nowMs: 100 });
  assert.ok(stateOf(s) === IntroState.LegalNotice && shows(s, "image", "legal/chineselegal.jpg"));
  s.update({ nowMs: 12099 });
  assert.equal(stateOf(s), IntroState.LegalNotice);
  s.update({ nowMs: 12100 });
  assert.equal(stateOf(s), IntroState.Lionhead);
  const t = new IntroSequence(makeIntroConfig(0, 1, true));
  t.update({ nowMs: 0 });
  t.requestSkip();
  t.update({ nowMs: 0 });
  assert.equal(stateOf(t), IntroState.Lionhead, "skippable even on the first launch");
});

test("the skip keys: polled, edge-triggered, Esc / Space / Enter, only with the window in front", () => {
  const now = { nowMs: 0 };
  const s = new IntroSequence(makeIntroConfig(0, 1, false));
  s.update(now); // -> lionhead (image mode, skippable)
  s.pollSkipKeys({ windowInFront: true, space: true });
  s.update(now);
  assert.equal(stateOf(s), IntroState.Activision, "space skips");
  s.pollSkipKeys({ windowInFront: true, space: true });
  s.update(now);
  assert.equal(stateOf(s), IntroState.Activision, "a held key skips once");
  s.pollSkipKeys({ windowInFront: true }); // released: the latch clears
  s.pollSkipKeys({ windowInFront: true, enter: true });
  s.update(now);
  assert.equal(stateOf(s), IntroState.Intel, "enter skips after a release");
  const t = new IntroSequence(makeIntroConfig(0, 1, false));
  t.update(now);
  t.pollSkipKeys({ windowInFront: true, esc: true });
  t.update(now);
  assert.equal(stateOf(t), IntroState.Activision, "esc skips");
  const u = new IntroSequence(makeIntroConfig(0, 1, false));
  u.update(now);
  u.pollSkipKeys({ windowInFront: false, esc: true });
  u.update(now);
  assert.equal(stateOf(u), IntroState.Lionhead, "esc with the window behind does nothing");
  // a key held into the next screen does not skip it too: the transition cleared the flag and the latch is still set
  const v = new IntroSequence(makeIntroConfig(0, 1, false));
  v.update(now);
  v.pollSkipKeys({ windowInFront: true, enter: true });
  v.update(now);
  v.pollSkipKeys({ windowInFront: true, enter: true });
  v.update(now);
  assert.equal(stateOf(v), IntroState.Activision);
});

test("the pump and the boot fork", () => {
  assert.equal(classifyPumpMessage(0x08), "drop");
  assert.equal(classifyPumpMessage(0x105), "drop");
  assert.equal(classifyPumpMessage(0x10), "quit");
  assert.equal(classifyPumpMessage(0x12), "quit");
  assert.equal(classifyPumpMessage(0x100), "dispatch");
  assert.equal(chooseBootPath(1), "gameLoopOnly");
  assert.equal(chooseBootPath(0), "introThenGameLoop");
  assert.equal(nextAfterIntro("finished"), "gameLoop");
  assert.equal(nextAfterIntro("windowClosed"), "shutdown");
});
