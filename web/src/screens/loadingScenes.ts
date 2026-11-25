// The "new loading screens" (docs/LOADING_SCREENS.md, "New loading scenes"): a scene is plain data, a character and a backdrop colour, drawn behind the text box.
// No engine types here, so Node tests can run it.

import { DEFAULT_CHARACTER, type CharacterSettings } from "./LoadingCharacterFraming.ts";

/** One loading scene: who stands where, doing what, in front of which colour. */
export interface LoadingScene {
  /** A name for the lab and the logs. */
  name: string;
  /** The character: costume (and a whole `look` if wanted), clip, the held frame, side, size, nudge and turn. `enabled` is forced on. */
  character: CharacterSettings;
  /** The backdrop, a CSS colour (a flat colour for now; a picture or gradient later). */
  background: string;
}

/**
 * The scenes a load picks from: the same man in a 50s costume, the clip held at its first frame, once on each side. The model does not face the camera at turn 0; a turn of 45
 * (to his right) faces it, which looks right on the left. On the right 45 left him looking a little off the screen's right edge and -45 made him face away, so he gets 75 (60 was not enough), a little
 * further to his right, towards the middle (all checked by eye).
 */
export const LOADING_SCENES: readonly LoadingScene[] = [
  {
    name: "standing, left",
    character: { ...DEFAULT_CHARACTER, enabled: true, side: "left", size: 0.85, costume: "m_50s_2.cos", clip: "idle_male.anm", frame: 0, turn: 45 },
    background: "#1d2a44",
  },
  {
    name: "standing, right",
    character: { ...DEFAULT_CHARACTER, enabled: true, side: "right", size: 0.85, costume: "m_50s_2.cos", clip: "idle_male.anm", frame: 0, turn: 75 },
    background: "#1d2a44",
  },
];

/**
 * One scene chosen uniformly at random (`random` is 0 <= r < 1; tests pass their own). `only` (the page's `?loadingScene=` value, for tuning) limits the choice to the scenes
 * whose name contains it, case ignored; when none does, every scene is in play.
 */
export function pickScene(random: () => number = Math.random, only?: string | null): LoadingScene {
  const wanted = only ? LOADING_SCENES.filter((s) => s.name.toLowerCase().includes(only.toLowerCase())) : [];
  const from = wanted.length > 0 ? wanted : LOADING_SCENES;
  return from[Math.min(from.length - 1, Math.floor(random() * from.length))]!;
}
