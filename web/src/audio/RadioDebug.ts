/** What the dev menu can do to the radio and its speech (`AudioManager.radioDebug`). Plain callbacks, so the menu needs no audio code. */
export type SpeechKind = "dj" | "news" | "tannoy";

/** The stages of the port's mix, from the music bus to the ducking: `music` and `sound` are the Options volumes' trims, `speech` and `tannoy` the clips' gains, `ambience` the birds, bells and planes, `duck` how far the music drops while a clip plays (1 is none). */
export type MixId = "music" | "sound" | "speech" | "tannoy" | "ambience" | "duck";

export interface MixStage {
  id: MixId;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
}

export interface RadioDebug {
  /** Read-only facts, refreshed a few times a second: the track, the DJ's window and roll, the speech queue and the last event. */
  rows(): Record<string, string>;
  /** Start the next track now. */
  nextTrack(): void;
  /** Queue the current DJ's chatter now, whatever the roll and the window. */
  djNow(): void;
  /** Make every DJ roll come up "speak". */
  setForceDj(on: boolean): void;
  /** Let clips through without the 30 s game-age rule and the 5 s gap. */
  setIgnoreLimits(on: boolean): void;
  /** A category's speech level: -1 off, 1 to 4 (the original's default is 3). */
  setLevel(kind: SpeechKind, level: number): void;
  /** The mix: one entry per stage, and a way to change one. */
  mixer(): MixStage[];
  setMix(id: MixId, value: number): void;
  /** The clip tags a bank holds (news: `TIMELINE_..`, tannoy: `TANNOY_..`). */
  tags(kind: "news" | "tannoy"): Promise<string[]>;
  /** Queue one clip; false when the queue refused it. */
  play(kind: SpeechKind, tag: string): boolean;
}
