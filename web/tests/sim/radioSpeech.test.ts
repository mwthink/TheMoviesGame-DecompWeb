import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { GAME_DIR } from "../../localPaths.ts";
import { clipMatchesEvent, djForYear, djMaySpeak, NewsAnnouncer, parseDjSchedule, parseTimelineEvents, SpeechQueue, SPEECH_GAP_MS } from "../../src/sim/audio/RadioSpeech.ts";

const STING = "Criteria,Start,End,Random\r\nRADIO_DJ_A_INTRO,0,1940,0\r\nRADIO_DJ_A,0,1940,1\r\nRADIO_DJ_B_INTRO,1941,1955,0\r\nRADIO_DJ_B,1941,1955,1\r\nRADIO_DJ_B_OUTRO,1941,1956,0\r\n";

test("the DJ for a year: chatter, intro and outro tags", () => {
  const e = parseDjSchedule(STING);
  assert.deepEqual(djForYear(e, 1920), { talk: "RADIO_DJ_A", intro: "RADIO_DJ_A_INTRO" });
  assert.deepEqual(djForYear(e, 1950), { talk: "RADIO_DJ_B", intro: "RADIO_DJ_B_INTRO", outro: "RADIO_DJ_B_OUTRO" });
  assert.deepEqual(djForYear(e, 1956), { outro: "RADIO_DJ_B_OUTRO" });
  assert.deepEqual(djForYear(e, 3000), {});
});

test("the DJ speaks over a track after its cue and before the half way point, five times in six", () => {
  assert.equal(djMaySpeak(0.03, 0.05, 0), false);
  assert.equal(djMaySpeak(0.06, 0.05, 4), true);
  assert.equal(djMaySpeak(0.06, 0.05, 5), false);
  assert.equal(djMaySpeak(0.5, 0.05, 0), false);
});

test("timeline events are the timeline_ rows with a decimal year", () => {
  const ev = parseTimelineEvents("[constants],,\r\nhalflife,4,\r\n[timeline],year,x\r\n,1900,\r\ntimeline_BAYOFPIGS,1961.25,,\r\ntimeline_television-invented,1927.666,\r\n");
  assert.deepEqual(ev, [{ tag: "TIMELINE_BAYOFPIGS", year: 1961.25 }, { tag: "TIMELINE_TELEVISION-INVENTED", year: 1927.666 }]);
});

test("news: the future clip two years ahead, the clip itself after the event, each once, only when the bank has it", () => {
  const have = new Set(["TIMELINE_X", "TIMELINE_X_FUTURE", "TIMELINE_Y"]);
  const n = new NewsAnnouncer([{ tag: "TIMELINE_X", year: 1950 }, { tag: "TIMELINE_Y", year: 1950 }], (t) => have.has(t));
  assert.deepEqual(n.due(1947), []);
  assert.deepEqual(n.due(1948.1), ["TIMELINE_X_FUTURE"]); // Y_FUTURE is not in the bank
  assert.deepEqual(n.due(1948.2), []);
  assert.deepEqual(n.due(1950.1), ["TIMELINE_X", "TIMELINE_Y"]);
  assert.deepEqual(n.due(1950.2), []);
  const late = new NewsAnnouncer([{ tag: "TIMELINE_X", year: 1950 }], () => true);
  assert.deepEqual(late.due(1960), []); // a game that starts years after the event hears nothing
});

test("the speech queue: levels, duplicates, early announcements, the gap and priority order", () => {
  const q = new SpeechQueue();
  assert.equal(q.queue({ tag: "T1", category: "news", priority: 1 }, 100), false); // too early in the game
  assert.equal(q.queue({ tag: "T1", category: "news", priority: 1 }, 300), true);
  assert.equal(q.queue({ tag: "T1", category: "news", priority: 1 }, 300), false); // already waiting
  assert.equal(q.queue({ tag: "D", category: "dj", priority: 2 }, 0), true);
  assert.equal(q.queue({ tag: "P", category: "dj", priority: 4 }, 0), false); // level 3 < priority 4
  q.levels.news = -1;
  assert.equal(q.queue({ tag: "T2", category: "news", priority: 1 }, 999), false);
  q.levels.news = 3;
  assert.equal(q.next(SPEECH_GAP_MS - 1), undefined);
  assert.equal(q.next(SPEECH_GAP_MS)?.tag, "T1"); // priority 1 before 2
  assert.equal(q.next(SPEECH_GAP_MS)?.tag, "D");
  assert.equal(q.next(SPEECH_GAP_MS), undefined);
});

const dir = GAME_DIR ? join(GAME_DIR, "Data", "Audio") : "";
test("the shipped DJ schedule has a DJ for every year from 1920 to 2024", { skip: existsSync(join(dir, "radiostinginfo.csv")) ? false : "game audio not found" }, () => {
  const e = parseDjSchedule(readFileSync(join(dir, "radiostinginfo.csv"), "latin1"));
  for (let y = 1920; y <= 2024; y++) assert.ok(djForYear(e, y).talk, `year ${y}`);
  assert.equal(djForYear(e, 1960).talk, "RADIO_DJ_MADDOG");
  assert.equal(djForYear(e, 1992).outro, "RADIO_DJ_KRISTEN_OUTRO");
});

test("clips of a tag come out as a shuffle bag: all of them before any repeats", async () => {
  const { ClipBag } = await import("../../src/sim/audio/RadioSpeech.ts");
  let seed = 7;
  const bag = new ClipBag(() => ((seed = (seed * 16807) % 2147483647) / 2147483647));
  const first = [0, 1, 2, 3].map(() => bag.take("A", 4));
  assert.deepEqual([...first].sort(), [0, 1, 2, 3]);
  const second = [0, 1, 2, 3].map(() => bag.take("A", 4));
  assert.deepEqual([...second].sort(), [0, 1, 2, 3]);
  assert.equal(bag.take("none", 0), -1);
  assert.equal(bag.take("B", 1), 0);
});

test("a news clip lights its event's icon: the event's tag, or the tag plus _FUTURE", () => {
  assert.equal(clipMatchesEvent("TIMELINE_BAYOFPIGS", "TIMELINE_BAYOFPIGS"), true);
  assert.equal(clipMatchesEvent("TIMELINE_BAYOFPIGS_FUTURE", "TIMELINE_BAYOFPIGS"), true);
  assert.equal(clipMatchesEvent("TIMELINE_BAYOFPIGS", "TIMELINE_MOONLANDING"), false);
  assert.equal(clipMatchesEvent("TIMELINE_BAYOFPIGS_FUTURE_2", "TIMELINE_BAYOFPIGS"), false);
});

test("tannoy clips wait for 30 s of game time and for a PA level at or above their priority", () => {
  const q = new SpeechQueue();
  assert.equal(q.queue({ tag: "TANNOY_CASTING_COMPLETE", category: "tannoy", priority: 3 }, 299), false);
  assert.equal(q.queue({ tag: "TANNOY_CASTING_COMPLETE", category: "tannoy", priority: 3 }, 300), true);
  assert.equal(q.queue({ tag: "TANNOY_CASTING_COMPLETE", category: "tannoy", priority: 3 }, 300), false); // already waiting
  assert.equal(q.queue({ tag: "TANNOY_NEW_PACKRESEARCHED_X", category: "tannoy", priority: 4 }, 300), false); // the default level 3 is below priority 4
  q.levels.tannoy = 4;
  assert.equal(q.queue({ tag: "TANNOY_NEW_PACKRESEARCHED_X", category: "tannoy", priority: 4 }, 300), true);
  q.levels.tannoy = -1; // PA off: nothing waiting plays
  assert.equal(q.next(6000), undefined);
});
