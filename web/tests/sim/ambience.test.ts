import assert from "node:assert/strict";
import { test } from "node:test";
import { AmbienceEmitter, ambienceEra, ambienceGroup, ambienceLevels } from "../../src/sim/audio/Ambience.ts";

test("the ambience era is the latest of the four not after the year", () => {
  assert.equal(ambienceEra(1920), 1920);
  assert.equal(ambienceEra(1949.9), 1920);
  assert.equal(ambienceEra(1950), 1950);
  assert.equal(ambienceEra(1989), 1970);
  assert.equal(ambienceEra(2020), 1990);
  assert.equal(ambienceEra(1900), 1920);
  assert.equal(ambienceGroup("LOT", 1950), "LOT_1950");
});

test("the lot fades in over 60 units of focus y, the street fades in below zero, the global layer is constant", () => {
  assert.deepEqual(ambienceLevels(0), { LOT: 0, STREET: 0, GLOBAL: 1 });
  assert.deepEqual(ambienceLevels(30), { LOT: 0.5, STREET: 0, GLOBAL: 1 });
  assert.deepEqual(ambienceLevels(120), { LOT: 1, STREET: 0, GLOBAL: 1 });
  assert.deepEqual(ambienceLevels(-15), { LOT: 0, STREET: 0.25, GLOBAL: 1 });
  assert.deepEqual(ambienceLevels(-200), { LOT: 0, STREET: 1, GLOBAL: 1 });
});

test("an emitter plays clips that are off their cooldown and waits half to one and a half intervals", () => {
  let r = 0;
  const e = new AmbienceEmitter([{ id: 1, intervalSeconds: 10, cooldownMs: 4000 }, { id: 2, intervalSeconds: 10, cooldownMs: 100000 }], () => r);
  r = 0;
  const a = e.next(0)!;
  assert.equal(a.clip.id, 1);
  assert.equal(a.waitMs, 5000);
  r = 0.99;
  const b = e.next(1000)!; // clip 1 is cooling down: only clip 2 is ready
  assert.equal(b.clip.id, 2);
  assert.ok(Math.abs(b.waitMs - 14900) < 1);
  assert.equal(e.next(2000), null); // both cooling down
  assert.equal(e.next(5000)!.clip.id, 1);
});
