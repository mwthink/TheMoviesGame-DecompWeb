import type { SettingsStore } from "../settings/Settings.ts";
import { AUDIO_STATES, AudioStateMachine, type AudioEffect } from "../sim/audio/AudioStates.ts";

/** Fade time when a state is suspended or resumed: `fadetime` in the game's `Data/Audio/radioeffect.ini` (1200 ms). The original passes its own global (`DAT_00E51CD8`). */
const FADE_SECONDS = 1.2;

/** Where a music file can be fetched from (a URL the page can load), or null when this build has no way to read the game's audio. */
export type MusicLocator = (file: string) => string | null;

interface Voice {
  element: HTMLAudioElement;
  gain: GainNode;
  /** The state is current and should be audible: set while a play request waits for the browser's permission to make sound. */
  wanted: boolean;
}

/**
 * The browser side of the audio manager (docs/AUDIO.md): a Web Audio graph with a music bus and a sound-effects bus whose levels follow the settings, and one
 * voice per state that streams a music file. Which state is current is decided by `AudioStateMachine`; this class carries out its effects.
 *
 * Browsers only allow sound after a click or key press, so the first request waits for one; `unlock` is called from those events.
 * The radio and front-end playlist players (states 2 and 4) are not built yet: those states are silent.
 */
export class AudioManager {
  readonly machine = new AudioStateMachine();
  private context: AudioContext | null = null;
  private music: GainNode | null = null;
  private sfx: GainNode | null = null;
  private readonly voices = new Map<number, Voice>();
  private readonly settings: SettingsStore;
  private readonly locate: MusicLocator;

  constructor(settings: SettingsStore, locate: MusicLocator, target: Pick<Window, "addEventListener" | "removeEventListener"> | null = typeof window === "undefined" ? null : window) {
    this.settings = settings;
    this.locate = locate;
    settings.subscribe(() => this.applyVolumes());
    if (target) {
      const unlock = () => {
        this.unlock();
        target.removeEventListener("pointerdown", unlock);
        target.removeEventListener("keydown", unlock);
      };
      target.addEventListener("pointerdown", unlock);
      target.addEventListener("keydown", unlock);
    }
  }

  /** The sound-effects bus, for effects added later; null until the browser has allowed sound. */
  get effectsBus(): GainNode | null {
    return this.sfx;
  }

  /** `Audio_SetState`: `owner` is whatever will later call `removeState` for the same state. */
  setState(state: number, owner: number | string): void {
    this.apply(this.machine.setState(state, owner));
  }

  /** `Audio_RemoveState`. */
  removeState(state: number, owner: number | string): void {
    this.apply(this.machine.removeState(state, owner));
  }

  /** Create the audio graph (needs a user gesture) and start whatever is waiting. Safe to call again. */
  unlock(): void {
    if (!this.context) {
      const Ctx = typeof AudioContext === "undefined" ? undefined : AudioContext;
      if (!Ctx) return;
      this.context = new Ctx();
      this.music = this.context.createGain();
      this.sfx = this.context.createGain();
      this.music.connect(this.context.destination);
      this.sfx.connect(this.context.destination);
      this.applyVolumes();
    }
    void this.context.resume();
    for (const [state, v] of this.voices) if (v.wanted) this.play(state, v);
  }

  private applyVolumes(): void {
    const s = this.settings.get();
    if (this.music) this.music.gain.value = s.musicVolume;
    if (this.sfx) this.sfx.gain.value = s.soundVolume;
  }

  private apply(effects: readonly AudioEffect[]): void {
    for (const fx of effects) {
      if (fx.kind === "start") this.start(fx.state);
      else if (fx.kind === "resume") this.resume(fx.state);
      else if (fx.kind === "suspend") this.suspend(fx.state);
      else this.stop(fx.state);
    }
  }

  /** `AudioState_Start`: get the state's music ready. */
  private start(state: number): void {
    const file = AUDIO_STATES[state]?.file;
    if (!file || this.voices.has(state)) return;
    const url = this.locate(file);
    if (!url || typeof Audio === "undefined") return;
    const element = new Audio(url);
    element.loop = true; // the three music states pass loop -1
    element.preload = "auto";
    this.voices.set(state, { element, gain: null as unknown as GainNode, wanted: false });
  }

  private resume(state: number): void {
    const v = this.voices.get(state);
    if (!v) return;
    v.wanted = true;
    if (this.context && this.music) this.play(state, v);
  }

  private play(state: number, v: Voice): void {
    const ctx = this.context!;
    if (!v.gain) {
      v.gain = ctx.createGain();
      ctx.createMediaElementSource(v.element).connect(v.gain);
      v.gain.connect(this.music!);
    }
    v.gain.gain.cancelScheduledValues(ctx.currentTime);
    v.gain.gain.setValueAtTime(v.gain.gain.value, ctx.currentTime);
    v.gain.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE_SECONDS);
    v.element.play().catch(() => {
      // not allowed yet (no gesture) or the file is missing: stay wanted so the next unlock tries again
      void state;
    });
  }

  private suspend(state: number): void {
    const v = this.voices.get(state);
    if (!v) return;
    v.wanted = false;
    if (!this.context || !v.gain) {
      v.element.pause();
      return;
    }
    const t = this.context.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + FADE_SECONDS);
    window.setTimeout(() => { if (!v.wanted) v.element.pause(); }, FADE_SECONDS * 1000);
  }

  private stop(state: number): void {
    const v = this.voices.get(state);
    if (!v) return;
    this.suspend(state);
    this.voices.delete(state);
    window.setTimeout(() => { v.element.removeAttribute("src"); v.element.load(); }, FADE_SECONDS * 1000 + 50);
  }
}
