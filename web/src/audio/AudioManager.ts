import { RadioPlayer } from "./RadioPlayer.ts";
import { AmbiencePlayer } from "./AmbiencePlayer.ts";
import { SpeechPlayer } from "./SpeechPlayer.ts";
import type { TimelineEvent } from "../sim/audio/RadioSpeech.ts";
import type { SettingsStore } from "../settings/Settings.ts";
import { AUDIO_STATES, AudioStateMachine, type AudioEffect } from "../sim/audio/AudioStates.ts";

/** Fade time when a state is suspended or resumed: the original passes a global (`DAT_00E51CD8`, 1000 ms). */
const FADE_SECONDS = 1;
/**
 * How far the music drops while the DJ or the news speaks: not at all. [read] Nothing in the original's code lowers the music for a radio clip: the only voice
 * volumes `RadioChannel_SelectNextClip` (orig: 0x004F6ED0) and `FUN_004F30C0` set are speech voices (a clip is held to min(speech level, 0.1) while a higher-priority
 * voice plays), and the music channel's volume (`Audio_SetChannelVolume`, channel 1) is changed only by the options, the trailer editor and `FUN_00752270`. The
 * speech bank's own mixing was not examined, so a mixer-side duck is not ruled out [guess]; set this below 1 to add one.
 */
const DUCK_LEVEL = 1;

/** Where a file under `Data/Audio/` (`music/Tuning_Up.ogg`, `trackinfo.csv`) can be fetched from (a URL the page can load), or null when this build has no way to read the game's audio. */
export type MusicLocator = (path: string) => string | null;

/** What the manager needs from the running game. */
export interface GameInfo {
  /** The game's current year (the radio plays the tracks of that year). */
  year(): number;
  /** The game's date in days (365 to the year). */
  date(): number;
  /** The camera's focus y in the lot's coordinates (the ambience follows it). */
  focusY(): number;
  /** The timeline's events: the radio reads news about them. */
  events(): readonly TimelineEvent[];
  /** True for a studio just started: the radio opens with the tracks flagged to play first. */
  newGame(): boolean;
}

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
 * The radio (state 2) and the front end's player (state 4, the menus) are both `RadioPlayer`, each with its own playlist.
 */
export class AudioManager {
  readonly machine = new AudioStateMachine();
  private context: AudioContext | null = null;
  private music: GainNode | null = null;
  /** Between the music voices and the music bus: lowered while the radio talks. */
  private duck: GainNode | null = null;
  private readonly speech: SpeechPlayer;
  private readonly ambience: AmbiencePlayer;
  private sfx: GainNode | null = null;
  private readonly voices = new Map<number, Voice>();
  private readonly radio: RadioPlayer;
  /** The menus' player (state 4): the tracks flagged "Play in Random Mode", any year (`FUN_00446600`, orig: 0x00446600). */
  private readonly frontEnd: RadioPlayer;
  /** Told when a news clip starts (its tag) and ends (null); the game view lights the matching timeline icon. */
  onNews: ((tag: string | null) => void) | null = null;
  /** Set by the game while one is running. */
  game: GameInfo = { year: () => 1920, date: () => 1920 * 365, focusY: () => 60, events: () => [], newGame: () => false };
  private readonly settings: SettingsStore;
  private readonly locate: MusicLocator;

  constructor(settings: SettingsStore, locate: MusicLocator, target: Pick<Window, "addEventListener" | "removeEventListener"> | null = typeof window === "undefined" ? null : window) {
    this.settings = settings;
    this.locate = locate;
    this.radio = new RadioPlayer({
      graph: () => (this.context && this.duck ? { context: this.context, bus: this.duck } : null),
      djChatter: () => this.speech.djChatter(),
      locate: (path) => this.locate(path),
      year: () => this.game.year(),
      newGame: () => this.game.newGame(),
    });
    this.frontEnd = new RadioPlayer({
      graph: () => (this.context && this.duck ? { context: this.context, bus: this.duck } : null),
      djChatter: () => {},
      locate: (path) => this.locate(path),
      year: () => this.game.year(),
      newGame: () => this.game.newGame(),
    }, { mode: "frontEnd" });
    this.speech = new SpeechPlayer({
      graph: () => (this.context && this.sfx ? { context: this.context, speechBus: this.sfx } : null),
      locate: (path) => this.locate(path),
      date: () => this.game.date(),
      duck: (on) => this.setDuck(on),
      events: () => this.game.events(),
      onNews: (tag) => this.onNews?.(tag),
    });
    this.ambience = new AmbiencePlayer({
      graph: () => (this.context && this.sfx ? { context: this.context, bus: this.sfx } : null),
      locate: (path) => this.locate(path),
      year: () => this.game.year(),
      focusY: () => this.game.focusY(),
    });
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
      this.duck = this.context.createGain();
      this.duck.connect(this.music);
      this.music.connect(this.context.destination);
      this.sfx.connect(this.context.destination);
      this.applyVolumes();
    }
    void this.context.resume();
    for (const [state, v] of this.voices) if (v.wanted) this.play(state, v);
    for (const p of [this.radio, this.frontEnd]) if (p.isWanted) p.play();
  }

  /** A studio announcement for the PA (`TANNOY_CASTING_COMPLETE`, ...; docs/AUDIO.md, "The tannoy"). Returns whether it was accepted. */
  tannoy(tag: string, priority?: number): boolean {
    return this.speech.tannoy(tag, priority);
  }

  /** Withdraw a queued tannoy clip by its tag. */
  cancelTannoy(tag: string): boolean {
    return this.speech.cancelTannoy(tag);
  }

  /** A game was loaded: the radio starts its talk afresh (the DJ's introduction, the news for the new date). */
  newGameLoaded(): void {
    this.speech.reset();
  }

  /** The playlist player a state drives (`AudioState_Start`), or null for a state that streams a single file. */
  private playerFor(state: number): RadioPlayer | null {
    const kind = AUDIO_STATES[state]?.player;
    return kind === "radio" ? this.radio : kind === "frontEnd" ? this.frontEnd : null;
  }

  private setDuck(on: boolean): void {
    if (!this.context || !this.duck) return;
    const t = this.context.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setValueAtTime(this.duck.gain.value, t);
    this.duck.gain.linearRampToValueAtTime(on ? DUCK_LEVEL : 1, t + 0.4);
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
    if (this.playerFor(state)) return; // a playlist player picks its track when it is resumed
    const file = AUDIO_STATES[state]?.file;
    if (!file || this.voices.has(state)) return;
    const url = this.locate(`music/${file}`);
    if (!url || typeof Audio === "undefined") return;
    const element = new Audio(url);
    element.loop = true; // the three music states pass loop -1
    element.preload = "auto";
    this.voices.set(state, { element, gain: null as unknown as GainNode, wanted: false });
  }

  private resume(state: number): void {
    const player = this.playerFor(state);
    if (player) {
      player.play();
      this.speech.start();
      this.ambience.start();
      return;
    }
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
    const player = this.playerFor(state);
    if (player) {
      player.pause();
      this.speech.stop();
      this.ambience.stop();
      return;
    }
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
    const player = this.playerFor(state);
    if (player) {
      player.dispose();
      this.speech.stop();
      this.ambience.stop();
      return;
    }
    const v = this.voices.get(state);
    if (!v) return;
    this.suspend(state);
    this.voices.delete(state);
    window.setTimeout(() => { v.element.removeAttribute("src"); v.element.load(); }, FADE_SECONDS * 1000 + 50);
  }
}
