// The main menu's state machine, events and tables (docs/FRONTEND.md), from the decompile.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Ev, EXTERN_CALLBACKS, filmedCreditsPath, FrontEnd, MENU_ITEMS, rangeOf, Setting, State, type Effect, type TickInput } from "../../src/sim/frontend/FrontEnd.ts";

const find = <K extends Effect["kind"]>(fx: Effect[], kind: K) => fx.find((e) => e.kind === kind) as Extract<Effect, { kind: K }> | undefined;
const has = (fx: Effect[], kind: Effect["kind"], arg: number) => fx.some((e) => e.kind === kind && "arg" in e && e.arg === arg);
const tickN = (f: FrontEnd, n: number, input: TickInput = {}) => { for (let i = 0; i < n; i++) f.tick(input); };
const moviePath = (fx: Effect[]) => find(fx, "playMovie")?.text;

// read through a function so TypeScript does not keep a narrowed type across calls that change it
const stateOf = (x: { state: number }): number => x.state;
const num = (v: number): number => v;

test("boot: state 0, limit 10; the tick after the counter passes the limit shows the menu", () => {
  const f = new FrontEnd();
  assert.ok(stateOf(f) === State.Boot && num(f.limit) === 10 && num(f.frameCounter) === 0);
  tickN(f, 10);
  assert.ok(stateOf(f) === State.Boot && num(f.frameCounter) === 10);
  const fx = f.tick();
  assert.ok(stateOf(f) === State.Menu && f.menuShown);
  assert.ok(has(fx, "pushAudioState", 4), "tier 0 sets audio state 4");
  assert.ok(find(fx, "showMenu"), "the menu is built once");
  assert.equal(f.frameCounter, 0);
  assert.equal(f.limit, 10, "the limit is kept by state 1");
  const g = new FrontEnd();
  tickN(g, 11, { qualityTier: 2 });
  assert.equal(stateOf(g), State.Menu);
  const h = new FrontEnd();
  tickN(h, 10, { qualityTier: 1 });
  assert.ok(has(h.tick({ qualityTier: 1 }), "pushAudioState", 4), "tier 1 pushes it");
});

test("setState", () => {
  const f = new FrontEnd();
  assert.ok(f.setState(State.Boot).length === 0 && num(f.limit) === 10, "the same state does nothing");
  f.setState(State.Menu);
  assert.ok(stateOf(f) === State.Menu && num(f.limit) === 10);
  assert.ok(!find(f.setState(State.ReturnToMenu), "showMenu"));
  assert.ok(!find(f.setState(State.Menu), "showMenu") && f.menuShown, "showing the menu again does not rebuild it");
  f.setState(State.Leaving);
  assert.equal(f.limit, 25);
  f.setState(State.CreditsMain);
  assert.equal(f.limit, -1);
});

test("menu: the background pulses with the music volume", () => {
  const f = new FrontEnd();
  f.setState(State.Menu);
  assert.ok(Math.abs(find(f.tick({ backgroundPulses: true, musicVolume: 1 }), "backgroundAlpha")!.value - 0.9) < 1e-4);
  assert.ok(Math.abs(find(f.tick({ backgroundPulses: true, musicVolume: 0 }), "backgroundAlpha")!.value - 0.45) < 1e-4);
  assert.ok(!find(f.tick({ backgroundPulses: false }), "backgroundAlpha"));
});

test("events that leave the front end", () => {
  const f = new FrontEnd();
  f.setState(State.Menu);
  const fx = f.onEvent(Ev.NewGame, { playedBasics: true });
  assert.ok(has(fx, "openProfileScreen", 0) && stateOf(f) === State.Leaving && num(f.limit) === 25);
  assert.ok(f.onEvent(Ev.Sandbox, { playedBasics: true }).length === 0 && stateOf(f) === State.Leaving, "events are ignored while leaving");
  tickN(f, 24);
  assert.ok(!f.closeRequested);
  f.tick();
  assert.ok(f.closeRequested);

  const t = new FrontEnd();
  t.setState(State.Menu);
  const tfx = t.onEvent(Ev.NewGame, { playedBasics: false });
  assert.ok(find(tfx, "startTutorial") && !find(tfx, "openProfileScreen") && stateOf(t) === State.Leaving, "new game without the Basics runs the tutorial");
  assert.deepEqual(tfx[0], { kind: "backgroundVisible", arg: 1 }, "and hides the background first");

  assert.ok(has(new FrontEnd().onEvent(Ev.Sandbox), "openProfileScreen", 1));
  assert.ok(has(new FrontEnd().onEvent(Ev.AddOnQuickStart), "openProfileScreen", 3));
  const h = new FrontEnd();
  assert.ok(find(h.onEvent(Ev.Tutorial), "startTutorial") && stateOf(h) === State.Leaving);
  const r1 = new FrontEnd();
  assert.ok(r1.onEvent(Ev.Resume, { resumeAvailable: false }).length === 0 && stateOf(r1) === State.Boot);
  const r2 = new FrontEnd();
  assert.ok(find(r2.onEvent(Ev.Resume, { resumeAvailable: true }), "resumeGame") && stateOf(r2) === State.Leaving);
});

test("events that keep the front end", () => {
  const a = new FrontEnd();
  assert.ok(find(a.onEvent(Ev.OpenGame), "openLoadScreen") && stateOf(a) === State.Boot);
  assert.ok(find(new FrontEnd().onEvent(Ev.OpenGameAlt), "openLoadScreen"));
  const c = new FrontEnd();
  const fc = c.onEvent(Ev.Online);
  assert.ok(find(fc, "openOnlineScreen") && has(fc, "backgroundVisible", 1) && stateOf(c) === State.Boot);
  assert.ok(find(new FrontEnd().onEvent(Ev.TrailerEditor), "openTrailerEditor"));
  const u = new FrontEnd();
  assert.ok(u.onEvent(0x80d).length === 0 && u.onEvent(0x1234).length === 0, "unknown events do nothing");
});

test("credits: filmed (if the game was completed) -> expansion -> main -> back to the menu", () => {
  const f = new FrontEnd();
  f.setState(State.Menu);
  const fx = f.onEvent(Ev.Credits, { completedGame: true, qualityTier: 0, expackLowExists: true });
  assert.equal(moviePath(fx), "data/credits/filmedcredits_low.wmv");
  assert.ok(stateOf(f) === State.CreditsExpack && num(f.limit) === -1 && num(f.frameCounter) === 0);
  const input: TickInput = { qualityTier: 0, expackLowExists: true, movieFinishedOrNone: false };
  assert.ok(!find(f.tick(input), "playMovie") && stateOf(f) === State.CreditsExpack, "a playing movie holds the state");
  input.movieFinishedOrNone = true;
  const t3 = f.tick(input);
  assert.ok(moviePath(t3) === "data/credits/credits_expack_low.wmv" && stateOf(f) === State.CreditsMain);
  assert.ok(has(t3, "backgroundVisible", 1) && !f.menuReady);
  assert.ok(moviePath(f.tick(input)) === "data/credits/credits_low.wmv" && stateOf(f) === State.ReturnToMenu);
  const t2 = f.tick(input);
  assert.ok(stateOf(f) === State.Menu && has(t2, "popAudioState", 0) && find(t2, "startMenuReadyTimer"));
  f.tick({ ...input, nowMs: 1000 });
  assert.ok(f.menuReady, "ready 750 ms after the menu returns (timer started at 0)");

  const g = new FrontEnd();
  g.setState(State.Menu);
  assert.ok(moviePath(g.onEvent(Ev.Credits, { completedGame: false, qualityTier: 2 })) === "data/credits/credits_expack.wmv" && stateOf(g) === State.CreditsMain);
  assert.equal(moviePath(g.tick({ qualityTier: 2 })), "data/credits/credits.wmv");
  const lo = new FrontEnd();
  lo.setState(State.Menu);
  assert.equal(moviePath(lo.onEvent(Ev.Credits, { qualityTier: 1, expackLowExists: false })), "data/credits/credits_expack.wmv", "no _low file: the full one");
  const none = new FrontEnd();
  assert.ok(none.onEvent(Ev.Credits, { movieHostPresent: false }).length === 0 && stateOf(none) === State.Boot);
  assert.ok(filmedCreditsPath(1) === "data/credits/filmedcredits_low.wmv" && filmedCreditsPath(2) === "data/credits/filmedcredits.wmv");
});

test('"Skip Front End": 1 posts a sandbox, 2 a new game, once, on the first tick', () => {
  const f = new FrontEnd();
  assert.ok(has(f.tick({ skipFrontEndSetting: 1 }), "postEvent", Ev.Sandbox));
  assert.ok(!find(f.tick({ skipFrontEndSetting: 1 }), "postEvent"), "only once");
  assert.ok(has(new FrontEnd().tick({ skipFrontEndSetting: 2 }), "postEvent", Ev.NewGame));
  const h = new FrontEnd();
  h.tick();
  assert.ok(!find(h.tick({ skipFrontEndSetting: 1 }), "postEvent"), "a setting that appears later is too late");
  assert.ok(!find(new FrontEnd().tick({ skipFrontEndSetting: 3 }), "postEvent"));
});

test("tables", () => {
  assert.equal(MENU_ITEMS.length, 19);
  assert.deepEqual(MENU_ITEMS[0], { captionKey: "FRONTEND_RESUME", command: "$resume", onlyIfAddOnGate: false });
  assert.ok(MENU_ITEMS[17]!.onlyIfAddOnGate && MENU_ITEMS[18]!.onlyIfAddOnGate && !MENU_ITEMS[16]!.onlyIfAddOnGate);
  assert.ok(MENU_ITEMS[4]!.captionKey === "FRONTEND_NEW" && MENU_ITEMS[4]!.command === "$newgame");
  assert.equal(EXTERN_CALLBACKS.length, 35);
  assert.equal(EXTERN_CALLBACKS.filter((c) => c.onlyIfAddOnGate).length, 2);
  assert.equal(EXTERN_CALLBACKS.filter((c) => c.action === "postEvent").length, 9, "nine post events (quit sets a flag instead)");
  assert.equal(EXTERN_CALLBACKS[0]!.name, "ExternResIncrease");
  assert.ok(EXTERN_CALLBACKS[34]!.name === "ExternContinue" && EXTERN_CALLBACKS[34]!.onlyIfAddOnGate);
  assert.equal(EXTERN_CALLBACKS.find((c) => c.name === "ExternStartNewGame")!.arg, Ev.NewGame);
  assert.equal(EXTERN_CALLBACKS.find((c) => c.name === "ExternResume")!.arg, Ev.Resume);
  assert.deepEqual([rangeOf(Setting.Resolution).max, rangeOf(Setting.Difficulty).max, rangeOf(Setting.Blood).max, rangeOf(Setting.Detail).max, rangeOf(Setting.Detail).min], [3, 2, 4, 4, 0]);
});
