/**
 * The audio manager's states (docs/AUDIO.md, "Audio states"): which music the game plays, and the stack that decides which state is current.
 *
 * The original has seven states, one per situation: whatever opens a situation calls `Audio_SetState(state, owner, ...)` and whatever ends it calls
 * `Audio_RemoveState(state, owner, ...)`. The (state, owner) pairs live in a list; the last one is the state to fall back to. Only the current state is
 * heard, the others are suspended, so leaving the release screen resumes the radio where it stopped. This module is that bookkeeping, as plain data: each call
 * returns the effects the sound layer should perform.
 */

/** What a state plays. `file` is a music file under `Data/Audio/music/`; the radio and front-end players pick their own tracks. */
export interface AudioStateDef {
  id: number;
  /** What the state is for, from the callers of `Audio_SetState` / `Audio_RemoveState` (`AUDIO.md`). */
  situation: string;
  /** A single music file the state streams, or null. */
  file: string | null;
  /** Which playlist player the state drives (`AudioState_Start`): the in-game radio, the front end's, or none. */
  player: "radio" | "frontEnd" | null;
}

/** The table `AudioStates_DefineAll` (orig: 0x004F7890) builds. The three music states pass loop -1. */
export const AUDIO_STATES: readonly AudioStateDef[] = [
  { id: 0, situation: "nothing (the game object's own, and the front end's quiet moments)", file: null, player: null },
  { id: 1, situation: "loading: `Game_ConstructSystems` (orig: 0x00422750) sets it after the radio, `SaveLoad_PumpRequests` while loading or saving", file: "Tuning_Up.ogg", player: null },
  { id: 2, situation: "the game in progress: the radio", file: null, player: "radio" },
  { id: 3, situation: "the shot fiddler and trailer editor", file: null, player: null },
  { id: 4, situation: "the front end (`WFrontEnd`)", file: null, player: "frontEnd" },
  { id: 5, situation: "the release screens (`ReleaseScreen_Constructor`, the reviews page)", file: "Relaxing_By_The_Sea.ogg", player: null },
  { id: 6, situation: "the splash screen (`WSplashScreen_Tick` removes it)", file: "Movies_Intro.ogg", player: null },
];

/** Something for the sound layer to do. */
export type AudioEffect =
  /** Fade the state's sound out and pause its voices (`AudioState_SetSuspended`, suspend = 1). */
  | { kind: "suspend"; state: number }
  /** Fade it back in (`AudioState_SetSuspended`, suspend = 0). */
  | { kind: "resume"; state: number }
  /** Start what the state plays (`AudioState_Start`). */
  | { kind: "start"; state: number }
  /** Stop and release the state's voice (no longer in use). */
  | { kind: "stop"; state: number };

interface Entry { state: number; owner: number | string }

export class AudioStateMachine {
  /** The current state; 0 at the start. */
  current = 0;
  /**
   * The game's "radio off" flag (`*(DAT_00F87B04 + 9)`): while set, state 2 is neither started nor resumed. What sets it is not known; the original reads it in
   * `Audio_SetState` and `Audio_RemoveState` only.
   */
  radioSuppressed = false;
  private stack: Entry[] = [];

  /** The (state, owner) pairs, oldest first; the last is the state `removeState` falls back to. */
  entries(): readonly Entry[] {
    return this.stack;
  }

  /** orig: 0x004F98F0 `Audio_SetState`. */
  setState(state: number, owner: number | string): AudioEffect[] {
    // quirk: asking for the state that is already current does nothing, not even record the pair, so a later removeState for it finds nothing.
    if (this.current === state) return [];
    const fx: AudioEffect[] = [{ kind: "suspend", state: this.current }];
    this.current = state;
    if (state !== 2 || !this.radioSuppressed) fx.push({ kind: "start", state }, { kind: "resume", state });
    if (!this.stack.some((e) => e.state === state && e.owner === owner)) this.stack.push({ state, owner });
    return fx;
  }

  /** orig: 0x004F9B70 `Audio_RemoveState`. */
  removeState(state: number, owner: number | string): AudioEffect[] {
    const i = this.stack.findIndex((e) => e.state === state && e.owner === owner);
    if (i < 0) return [];
    this.stack.splice(i, 1);
    if (state === -1) return [];
    if (state !== this.current) return [{ kind: "stop", state }]; // a suspended state is let go
    const previous = this.current;
    if (this.stack.length === 0) {
      this.current = 0;
      return [{ kind: "stop", state: previous }];
    }
    this.current = this.stack[this.stack.length - 1].state;
    if (this.current === previous) return [];
    const fx: AudioEffect[] = [{ kind: "stop", state: previous }];
    if (this.current !== 2 || !this.radioSuppressed) fx.push({ kind: "resume", state: this.current });
    return fx;
  }
}
