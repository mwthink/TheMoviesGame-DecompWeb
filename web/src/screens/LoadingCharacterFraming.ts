// Where the loading screen's 3D character stands: settings and camera framing, with no engine types so Node tests can run them (docs/LOADING_SCREENS.md).

/** What the loading screen's 3D character looks like and where it stands (docs/LOADING_SCREENS.md, "The 3D character"). */
export interface CharacterSettings {
  enabled: boolean;
  /** Which half of the picture the character stands in. */
  side: "left" | "right";
  /** How much of the picture's height the character fills (1 = all of it). */
  size: number;
  /** Nudge from the side's centre, as a fraction of the picture's width (positive = right). */
  nudgeX: number;
  /** Nudge of the feet from the bottom margin, as a fraction of the picture's height (positive = up). */
  nudgeY: number;
  /** Turn about the vertical axis, degrees (0 = facing the viewer). */
  turn: number;
  /** The costume file (`m_50s_2.cos`) and the animation clip (`idle_male.anm`). */
  costume: string;
  clip: string;
}

export const DEFAULT_CHARACTER: Readonly<CharacterSettings> = { enabled: false, side: "left", size: 0.8, nudgeX: 0, nudgeY: 0, turn: 0, costume: "m_50s_2.cos", clip: "idle_male.anm" };

/** The height of a person in the models' units (a little over the tallest costume's 1.87), used to fit them to the picture. */
export const PERSON_HEIGHT = 1.9;

/** Where the feet stand, as a fraction of the picture's height up from the bottom, before the nudge. */
const FEET_MARGIN = 0.06;

/**
 * The camera framing for a character: an orthographic camera looking at the character's front, sized so the character fills `size` of the picture's height and placed so the
 * character appears at 25 % (left) or 75 % (right) of the width plus the nudge. Returns the camera's half height (world units), and where it looks (x, y in the scene).
 */
export function characterFraming(s: Pick<CharacterSettings, "side" | "size" | "nudgeX" | "nudgeY">): { halfHeight: number; lookX: number; lookY: number } {
  const height = PERSON_HEIGHT / Math.max(0.1, s.size); // the picture's height in world units
  const bottom = -(FEET_MARGIN + s.nudgeY) * height; // the world height of the picture's bottom edge
  const centre = (s.side === "left" ? 0.25 : 0.75) + s.nudgeX; // where, across the picture, the character appears
  return { halfHeight: height / 2, lookX: (0.5 - centre) * height, lookY: bottom + height / 2 };
}

