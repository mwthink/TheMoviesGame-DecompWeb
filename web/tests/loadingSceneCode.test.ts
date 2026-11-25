// A loading scene written as TypeScript for LOADING_SCENES (docs/LOADING_SCREENS.md, "The scene editor").
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeCharacter } from "../src/sim/character/CharacterCode.ts";
import { DEFAULT_CHARACTER } from "../src/screens/LoadingCharacterFraming.ts";
import { sceneToCode } from "../src/screens/loadingSceneCode.ts";
import { LOADING_SCENES, lookFromCode, type LoadingScene } from "../src/screens/loadingScenes.ts";

test("a built-in scene is written with its camera, held frame and no zero fields", () => {
  const code = sceneToCode(LOADING_SCENES[0]!);
  assert.match(code, /^\{\n  name: "standing, left",\n/);
  assert.match(code, /character: \{ \.\.\.DEFAULT_CHARACTER, enabled: true, side: "left", size: 0\.85, turn: 45, costume: "m_50s_2\.cos", clip: "idle_male\.anm", frame: 0 \},/);
  assert.match(code, /backdrop: \{ mesh: "set_saloon\.msh", eye: \[1, 8, 2\.2\], look: \[0, -4, 1\.8\], fovDeg: 70, blurPx: 14, brightness: 1 \},/);
  assert.ok(code.endsWith("},"));
});

test("a scene with a whole look writes it as a character code that reads back, and a looping clip has no frame", () => {
  const scene: LoadingScene = {
    name: "x \"quoted\"",
    character: { ...DEFAULT_CHARACTER, enabled: true, side: "right", size: 0.8, nudgeX: 0.0125, costume: "f_20s_1.cos", clip: "idle_female.anm",
      look: { cos: "f_20s_1.cos", head: "", hair: "hair_20s_f1.msh", ageYears: 28, weightKg: 60, layers: { 2: 1 }, accessories: {} } },
    background: "#102030",
  };
  const code = sceneToCode(scene);
  assert.match(code, /name: "x \\"quoted\\"",/);
  assert.match(code, /nudgeX: 0\.013/);
  assert.ok(!code.includes("frame:") && !code.includes("backdrop:") && !code.includes("turn:") && !code.includes("nudgeY"));
  const m = /lookFromCode\(("[^"]+")\)/.exec(code);
  assert.ok(m);
  const look = lookFromCode(JSON.parse(m![1]!));
  assert.deepEqual(look, scene.character.look);
  assert.deepEqual(decodeCharacter(JSON.parse(m![1]!)), scene.character.look);
});

test("lookFromCode refuses something that is not a character code", () => {
  assert.throws(() => lookFromCode("hello"));
});
