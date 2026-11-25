// Settings: normalising stored data, the store and its storage (docs/OPTIONS.md). No game files needed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, SettingsStore, normalizeSettings, type SettingsStorage } from "../../src/settings/Settings.ts";

class MemoryStorage implements SettingsStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

test("anything unreadable becomes the defaults", () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings("junk"), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({ renderScale: "big", anisotropy: 3, helpLevel: "lots", showFps: 1 }), DEFAULT_SETTINGS);
});

test("numbers are clamped and snapped to what the screen offers", () => {
  assert.equal(normalizeSettings({ renderScale: 0.1 }).renderScale, 0.5);
  assert.equal(normalizeSettings({ renderScale: 9 }).renderScale, 1.5);
  assert.equal(normalizeSettings({ renderScale: 0.8 }).renderScale, 0.75);
  assert.equal(normalizeSettings({ anisotropy: 16 }).anisotropy, 16);
  assert.equal(normalizeSettings({ anisotropy: NaN }).anisotropy, DEFAULT_SETTINGS.anisotropy);
});

test("the store saves, reloads, notifies and resets", () => {
  const storage = new MemoryStorage();
  const store = new SettingsStore(storage);
  const seen: boolean[] = [];
  const stop = store.subscribe((s) => seen.push(s.showFps));
  store.set({ showFps: true, helpLevel: "none" });
  assert.deepEqual(seen, [true]);
  assert.equal(new SettingsStore(storage).get().helpLevel, "none"); // a new visit reads it back
  stop();
  store.set({ showFps: false });
  assert.deepEqual(seen, [true]);
  store.reset();
  assert.deepEqual(store.get(), DEFAULT_SETTINGS);
});

test("damaged storage does not stop the app", () => {
  const storage = new MemoryStorage();
  storage.setItem("otm.settings.v1", "{not json");
  assert.deepEqual(new SettingsStore(storage).get(), DEFAULT_SETTINGS);
  assert.deepEqual(new SettingsStore(null).get(), DEFAULT_SETTINGS);
});
