/**
 * The ambience of a running game (docs/AUDIO.md, "Ambience"): three layers of background sound, chosen by era, whose levels follow where the camera looks.
 * Plain data and rules; the sound is `audio/AmbiencePlayer.ts`.
 */

/** The three layers, in the order `Audio_StartAmbienceLoops` (orig: 0x004F5F90) starts them. */
export const AMBIENCE_LAYERS = ["LOT", "STREET", "GLOBAL"] as const;
export type AmbienceLayer = (typeof AMBIENCE_LAYERS)[number];

/** The eras `world.lug` has ambience for: its sample groups end in these years. */
export const AMBIENCE_ERAS = [1920, 1950, 1970, 1990] as const;

/**
 * The era for a game year. [guess] The original rounds the year through a function pointer (`DAT_0105BEA4`, in `Audio_OnYearChanged`, orig: 0x004F6310) that
 * was not followed; the banks only have these four eras, so the latest era not after the year is used.
 */
export function ambienceEra(year: number): number {
  let era: number = AMBIENCE_ERAS[0];
  for (const e of AMBIENCE_ERAS) if (year >= e) era = e;
  return era;
}

/** The sample group a layer plays in an era: `Audio_BuildAmbienceTag` (orig: 0x004F55B0) gives `LOT_1950`; the banks spell it in mixed case. */
export function ambienceGroup(layer: AmbienceLayer, era: number): string {
  return `${layer}_${era}`;
}

/** `DAT_00E51CDC`: the distance over which the lot and street layers fade. */
export const AMBIENCE_FADE_RANGE = 60;

/**
 * The level of each layer for a camera focus. orig: `Audio_UpdateAmbienceVolumes` (0x004F3B80): `y` is `*(DAT_00F87AA0 + 0xE0)`, the focus's y (`CAMERA.md`: the
 * camera object's `+0xDC` is the focus, x, y, z). The lot layer is `clamp((y - DAT_0104B0C8) / 60)` and the street layer `clamp((DAT_0104B0CC - y) / 60)`; the global
 * layer is constant. Nothing in the code writes `DAT_0104B0C8` / `DAT_0104B0CC`, so both are the zero a static variable starts with: the lot fades in over the first
 * 60 units of y inside the gate and the street layer is heard only beyond y < 0, outside the lot.
 */
export function ambienceLevels(focusY: number, lotEdge = 0, streetEdge = 0): Record<AmbienceLayer, number> {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return {
    LOT: clamp((focusY - lotEdge) / AMBIENCE_FADE_RANGE),
    STREET: clamp((streetEdge - focusY) / AMBIENCE_FADE_RANGE),
    GLOBAL: 1,
  };
}

/** A clip an ambience layer can play. */
export interface AmbienceClip {
  id: number;
  /** Record `+0x118`'s high word: 5 for the lot's birds, 11 for the street, 14 to 17 for planes. [guess] The usual number of seconds between this layer's sounds. */
  intervalSeconds: number;
  /** Record `+0x27C`: 450 to 4000. [guess] Milliseconds before this clip may play again. */
  cooldownMs: number;
}

/**
 * When a layer plays what. [guess] Everything here is inferred from the bank's records, not from the engine code: a layer plays a random clip that is off its cooldown
 * and then waits between half and one and a half times the clip's interval.
 */
export class AmbienceEmitter {
  private readonly clips: readonly AmbienceClip[];
  private readonly random: () => number;
  private readonly lastPlayed = new Map<number, number>();

  constructor(clips: readonly AmbienceClip[], random: () => number = Math.random) {
    this.clips = clips;
    this.random = random;
  }

  /** The clip to play now (null when none is ready) and how long to wait afterwards, in milliseconds. */
  next(nowMs: number): { clip: AmbienceClip; waitMs: number } | null {
    const ready = this.clips.filter((c) => nowMs - (this.lastPlayed.get(c.id) ?? -Infinity) >= c.cooldownMs);
    if (ready.length === 0) return null;
    const clip = ready[Math.min(ready.length - 1, Math.floor(this.random() * ready.length))]!;
    this.lastPlayed.set(clip.id, nowMs);
    return { clip, waitMs: clip.intervalSeconds * 1000 * (0.5 + this.random()) };
  }
}
