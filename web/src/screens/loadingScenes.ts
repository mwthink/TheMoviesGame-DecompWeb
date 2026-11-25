// The "new loading screens" (docs/LOADING_SCREENS.md, "New loading scenes"): a scene is plain data, a character and a backdrop colour, drawn behind the text box.
// No engine types here, so Node tests can run it.

import { decodeCharacter, type CharacterLook } from "../sim/character/CharacterCode.ts";
import { DEFAULT_CHARACTER, type CharacterSettings } from "./LoadingCharacterFraming.ts";

/** A whole look from a character code (`OTMCHAR1:...`, made by the character viewer's "Copy character to clipboard"), for scenes written as code; throws when it is not one. */
export function lookFromCode(code: string): CharacterLook {
  const look = decodeCharacter(code);
  if (!look) throw new Error("not a character code");
  return look;
}

/**
 * A film set drawn big and blurred behind the character (`LoadingBackdrop.ts`). Positions are in the game's coordinates (x, y, z up; the saloon spans about x -12..11,
 * y -14.5..14, z 0..6). It is a suggestion of a place, not scaled to the person.
 */
export interface BackdropSettings {
  /** The set's model file (`set_saloon.msh`). */
  mesh: string;
  /** Where the camera stands and what it looks at. */
  eye: readonly [number, number, number];
  look: readonly [number, number, number];
  /** Vertical field of view in degrees: a narrow one blows the set up. */
  fovDeg: number;
  /** CSS blur in pixels (of the full-size window) and brightness (1 = as drawn). */
  blurPx: number;
  brightness: number;
}

/** One loading scene: who stands where, doing what, in front of which colour. */
export interface LoadingScene {
  /** A name for the lab and the logs. */
  name: string;
  /** The character: costume (and a whole `look` if wanted), clip, the held frame, side, size, nudge and turn. `enabled` is forced on. */
  character: CharacterSettings;
  /** The backdrop colour (CSS), shown while a set is drawn behind the character and kept when there is none or it cannot be drawn. */
  background: string;
  /** A film set drawn big and blurred behind the character; left out, just the colour. */
  backdrop?: BackdropSettings;
}

/**
 * The saloon from inside, near the back, looking down the room towards the front windows: the bar's rail, the rug and the balcony come out as warm dark shapes once blurred.
 * (The set spans about x -8..8, y -6..10 inside; the front wall is at y -6. A camera outside it sees only planks.) Tuned by eye; the textures are unlit, so it is dark.
 */
const SALOON: BackdropSettings = { mesh: "set_saloon.msh", eye: [1, 8, 2.2], look: [0, -4, 1.8], fovDeg: 70, blurPx: 14, brightness: 1 };

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
    backdrop: SALOON,
  },
  {
    name: "standing, right",
    character: { ...DEFAULT_CHARACTER, enabled: true, side: "right", size: 0.85, costume: "m_50s_2.cos", clip: "idle_male.anm", frame: 0, turn: 75 },
    background: "#1d2a44",
    backdrop: SALOON,
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
