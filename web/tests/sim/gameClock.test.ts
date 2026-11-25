// The game clock: calendar maths, fixed 10 Hz timestep, pause and speed (docs/MAIN_LOOP.md). No game files needed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GameClock, calendarDate, formatDate, ticksPerDayForYear } from "../../src/sim/core/GameClock.ts";

test("dates: 1 Jan 1920 is 1920 x 365 days, the fraction is the time of day", () => {
  assert.equal(formatDate(1920 * 365), "1 Jan 1920");
  assert.equal(formatDate(1920 * 365 + 31), "1 Feb 1920");
  assert.equal(formatDate(1920 * 365 + 364.5), "31 Dec 1920");
  const c = calendarDate(715563.875); // June 1960 (docs/SAVE_FORMAT.md), 21:00
  assert.deepEqual([c.year, c.month, c.hour], [1960, 5, 21]);
});

test("one simulation tick per 0.1 s of speed-scaled time", () => {
  const clock = new GameClock(1960 * 365);
  assert.equal(clock.advance(0.05), 0);
  assert.equal(clock.advance(0.05), 1); // the accumulator reached 0.1
  assert.equal(clock.advance(0.35), 3);
  assert.equal(clock.ticks, 4);
  clock.speed = "fast";
  assert.equal(clock.advance(0.1), 3);
  clock.speed = "pause";
  assert.equal(clock.advance(10), 0);
  const frozen = clock.date;
  clock.advance(10);
  assert.equal(clock.date, frozen);
});

test("a day passes after ticksPerDay ticks and the weekday advances", () => {
  const clock = new GameClock(1960 * 365);
  assert.equal(clock.ticksPerDay, ticksPerDayForYear(1960));
  for (let i = 0; i < clock.ticksPerDay; i++) clock.tick();
  assert.equal(Math.floor(clock.date), 1960 * 365 + 1);
  assert.equal(clock.weekday, 1);
});

test("a long stall does not run an unbounded number of ticks", () => {
  const clock = new GameClock(0);
  assert.ok(clock.advance(60) <= 5);
});
