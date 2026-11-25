import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseCues, parseTrackInfo, RadioPlaylist } from "../../src/sim/audio/Radio.ts";
import { GAME_DIR } from "../../localPaths.ts";

const HEAD = "Track,Start,End,Put on Radio,Volume,Action,Comedy,Horror,Romance,Scifi,Thriller,War,Western,Play in Random Mode,Play these songs first in new game\r\n";
const CSV = HEAD
  + "Old_One,1920,1950,1,0.45,0,0.5,0,1,0,0,0,0,0,0\r\n"
  + "Both,1930,10000,1,0.35,1,0,0,0,0,0,0,0,0,0\r\n"
  + "Late,1960,10000,1,0.45,0,0,0,0,0,0,0,0,0,0\r\n"
  + "Hidden,1920,10000,0,0.45,0,0,0,0,0,0,0,0,0,0\r\n"
  + "Opener,1920,1980,1,0.45,0,0,0,0,0,0,0,0,0,1\r\n\r\n";

test("trackinfo.csv rows are read by column name", () => {
  const t = parseTrackInfo(CSV);
  assert.deepEqual(t.map((x) => x.name), ["Old_One", "Both", "Late", "Hidden", "Opener"]);
  assert.equal(t[0].genres.Comedy, 0.5);
  assert.equal(t[0].genres.Romance, 1);
  assert.equal(t[1].volume, 0.35);
  assert.equal(t[3].onRadio, false);
  assert.equal(t[4].playFirst, true);
  assert.equal(t[1].endYear, 10000);
});

test("cue files give millisecond marks", () => {
  assert.deepEqual(parseCues("// Cue list for 'x.cue'\r\n\"NEXT_MUSIC_START\" = 107369\r\n\"DJ_STING\" = 5479\r\n"), { nextMusicStart: 107369, djSting: 5479 });
  assert.deepEqual(parseCues("\"DJ_STING\" = 5201\r\n"), { djSting: 5201 });
  assert.deepEqual(parseCues(""), {});
});

test("the radio plays only tracks that are on the radio and in the year", () => {
  const radio = new RadioPlaylist(parseTrackInfo(CSV));
  assert.deepEqual(radio.eligible(1925).map((t) => t.name), ["Old_One", "Opener"]);
  assert.deepEqual(radio.eligible(1935).map((t) => t.name), ["Old_One", "Both", "Opener"]);
  assert.deepEqual(radio.eligible(1990).map((t) => t.name), ["Both", "Late"]);
  assert.equal(radio.eligible(1900).length, 0);
  assert.equal(radio.next(1900), undefined);
});

test("every eligible track plays once before any repeats, and a round never starts with the last track", () => {
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const radio = new RadioPlaylist(parseTrackInfo(CSV), { random });
  const names: string[] = [];
  for (let i = 0; i < 9; i++) names.push(radio.next(1935)!.name);
  for (const round of [names.slice(0, 3), names.slice(3, 6), names.slice(6, 9)]) assert.deepEqual([...round].sort(), ["Both", "Old_One", "Opener"]);
  assert.notEqual(names[3], names[2]);
  assert.notEqual(names[6], names[5]);
});

test("a year change drops tracks that no longer fit and brings in new ones", () => {
  const radio = new RadioPlaylist(parseTrackInfo(CSV), { random: () => 0 });
  assert.equal(radio.next(1925)!.name, "Old_One");
  assert.equal(radio.next(1925)!.name, "Opener");
  assert.equal(radio.next(1990)!.name, "Both"); // Old_One and Opener are over; Both and Late are in
  assert.equal(radio.next(1990)!.name, "Late");
});

test("a new game starts with the tracks flagged to play first", () => {
  const radio = new RadioPlaylist(parseTrackInfo(CSV), { preferFirst: true, random: () => 0 });
  assert.equal(radio.next(1925)!.name, "Opener");
  assert.equal(radio.next(1925)!.name, "Old_One");
});

test("the shipped library: 102 tracks, 60 on the radio, one played first", { skip: GAME_DIR && existsSync(join(GAME_DIR, "Data", "Audio", "trackinfo.csv")) ? false : "game audio not found" }, () => {
  const t = parseTrackInfo(readFileSync(join(GAME_DIR!, "Data", "Audio", "trackinfo.csv"), "latin1"));
  assert.equal(t.length, 102);
  assert.equal(t.filter((x) => x.onRadio).length, 60);
  assert.deepEqual(t.filter((x) => x.playFirst).map((x) => x.name), ["Top_Hat_And_Tails"]);
  const radio = new RadioPlaylist(t);
  assert.equal(radio.eligible(1920).length, 8);
  assert.equal(radio.eligible(1990).length, 40);
});
