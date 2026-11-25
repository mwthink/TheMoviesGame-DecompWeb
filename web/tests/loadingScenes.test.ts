// The new loading scenes: plain data and the settings switch (docs/LOADING_SCREENS.md).
import assert from "node:assert/strict";
import { test } from "node:test";
import { LOADING_SCENES, pickScene } from "../src/screens/loadingScenes.ts";
import { characterFraming } from "../src/screens/LoadingCharacterFraming.ts";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/settings/Settings.ts";

test("every scene has an enabled character, a held frame or a clip, and a colour", () => {
  assert.ok(LOADING_SCENES.length > 0);
  for (const s of LOADING_SCENES) {
    assert.ok(s.character.enabled && s.character.costume.endsWith(".cos") && s.character.clip.endsWith(".anm"), s.name);
    assert.ok(/^#[0-9a-f]{6}$/i.test(s.background), s.name);
    const f = characterFraming(s.character);
    assert.ok(f.halfHeight > 0 && Number.isFinite(f.lookX) && Number.isFinite(f.lookY), s.name);
  }
});

test("a scene's backdrop camera looks somewhere other than where it stands, with a sane field of view", () => {
  for (const s of LOADING_SCENES) {
    const b = s.backdrop;
    if (!b) continue;
    assert.ok(b.mesh.endsWith(".msh"), s.name);
    assert.ok(b.eye.some((v, i) => v !== b.look[i]), s.name);
    assert.ok(b.fovDeg > 10 && b.fovDeg < 120 && b.blurPx >= 0 && b.brightness > 0 && b.brightness <= 1.5, s.name);
  }
});

test("pickScene covers the list and never runs off its end", () => {
  assert.equal(pickScene(() => 0), LOADING_SCENES[0]);
  assert.equal(pickScene(() => 0.999999), LOADING_SCENES[LOADING_SCENES.length - 1]);
});

test("pickScene can be limited to the scenes whose name contains a word", () => {
  assert.equal(pickScene(() => 0, "RIGHT").name, "standing, right");
  assert.equal(pickScene(() => 0.9, "left").name, "standing, left");
  assert.equal(pickScene(() => 0, "nothing like it"), LOADING_SCENES[0]);
});

test("the new loading screens switch is off by default and read safely", () => {
  assert.equal(DEFAULT_SETTINGS.newLoadingScreens, false);
  assert.equal(normalizeSettings({ newLoadingScreens: true }).newLoadingScreens, true);
  assert.equal(normalizeSettings({ newLoadingScreens: "yes" }).newLoadingScreens, false);
});
