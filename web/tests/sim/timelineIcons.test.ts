// The timeline's award and research icons (docs/AUDIO.md, "Timeline icons: what they do").
import assert from "node:assert/strict";
import { test } from "node:test";
import { awardIcons, awardsEnabled, researchIcons, type AwardsClock } from "../../src/sim/ui/TimelineIcons.ts";

const year = (y: number) => y * 365;
const clock = (over: Partial<AwardsClock> = {}): AwardsClock => ({ previous: year(1920), firstYear: 1925, interval: 5, enabled: true, ...over });

test("the awards run in a new game and an add-on quick start, not the tutorial or the sandbox", () => {
  assert.deepEqual([0, 1, 2, 3].map(awardsEnabled), [false, true, false, true]);
  assert.deepEqual(awardIcons(clock({ enabled: false }), year(1920)), []);
});

test("a new studio shows the next ceremony and the one after, and no previous one before the first awards year", () => {
  const icons = awardIcons(clock(), year(1920));
  assert.deepEqual(icons.map((i) => [i.id, i.year]), [["award:next", 1925], ["award:after", 1930]]);
  assert.ok(icons.every((i) => i.picture === "award"));
});

test("with a ceremony behind, the previous one shows too", () => {
  const icons = awardIcons(clock({ previous: year(1960), firstYear: 1925 }), year(1960.4));
  assert.deepEqual(icons.map((i) => [i.id, i.year]), [["award:previous", 1960], ["award:next", 1965], ["award:after", 1970]]);
});

test("the clock rolls forward by whole intervals when the date passes the next ceremony", () => {
  const icons = awardIcons(clock({ previous: year(1960) }), year(1966));
  assert.deepEqual(icons.map((i) => i.year), [1965, 1970, 1975]);
});

test("the late picture is used from 2004 to 2009", () => {
  const pic = (y: number) => awardIcons(clock({ previous: year(2000) }), year(y))[0]!.picture;
  assert.deepEqual([2003, 2004, 2009, 2010].map(pic), ["award", "award2", "award2", "award"]);
});

test("a research pack shows from 14 days before it unlocks and keeps its date; packs with no date or far ahead do not show", () => {
  const packs = [
    { name: "wild_west_3", unlocked: false, unlockDate: year(1950) + 100 },
    { name: "war_4", unlocked: false, unlockDate: 0 },
    { name: "set_2", unlocked: true, unlockDate: year(1950) + 30 },
    { name: "tech_1", unlocked: true, unlockDate: year(1931) }, // long past: off the bar's left edge
  ];
  assert.deepEqual(researchIcons(packs, year(1950) + 80).map((i) => i.id), ["research:set_2"]); // wild_west_3 is 20 days ahead: not yet
  const near = researchIcons(packs, year(1950) + 90);
  assert.deepEqual(near.map((i) => i.id), ["research:wild_west_3", "research:set_2"]);
  assert.equal(near[0]!.title, "Research: wild west 3");
  assert.equal(near[0]!.detail, "Becomes available to research.");
  assert.equal(near[1]!.detail, "Unlocked.");
  assert.ok(Math.abs(near[0]!.year - (1950 + 100 / 365)) < 1e-9);
});
