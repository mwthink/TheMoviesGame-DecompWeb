// The character string copied between the viewer and the loading-screen editor.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeCharacter, encodeCharacter } from "../../src/sim/character/CharacterCode.ts";

test("a character survives the round trip", () => {
  const c = { cos: "m_50s_2.cos", head: "head_m_white_joe.hd", hair: "hair_20s_m1.msh", ageYears: 41, weightKg: 83, layers: { 0: 2, 2: 5 }, accessories: { 0: 4 } };
  const text = encodeCharacter(c);
  assert.ok(text.startsWith("OTMCHAR1:") && !/\s/.test(text));
  assert.deepEqual(decodeCharacter(`  ${text}\n`), c);
});

test("anything else is refused", () => {
  assert.equal(decodeCharacter("hello"), null);
  assert.equal(decodeCharacter("OTMCHAR1:!!!"), null);
  assert.equal(decodeCharacter("OTMCHAR1:" + btoa('["../x.cos","","",30,70,{},{}]')), null);
  assert.equal(decodeCharacter("OTMCHAR1:" + btoa('[1,2]')), null);
});
