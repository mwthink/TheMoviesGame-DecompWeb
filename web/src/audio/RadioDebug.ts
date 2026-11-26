/** What the dev menu can do to the radio and its speech (`AudioManager.radioDebug`). Plain callbacks, so the menu needs no audio code. */
export type SpeechKind = "dj" | "news" | "tannoy";

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
  /** The clip tags a bank holds (news: `TIMELINE_..`, tannoy: `TANNOY_..`). */
  tags(kind: "news" | "tannoy"): Promise<string[]>;
  /** Queue one clip; false when the queue refused it. */
  play(kind: SpeechKind, tag: string): boolean;
}
