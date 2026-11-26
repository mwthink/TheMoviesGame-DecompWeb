/**
 * The player's settings (docs/OPTIONS.md): what the web app lets them change, how it is stored, and how to read a stored value safely.
 *
 * The original keeps its settings in the registry (`Config_GetOrCreateBool` / `Config_GetOrCreateInt`, orig 0x00541E50 / 0x00541C00: `Fullscreen`, `Audio Off`,
 * `Autosave Setting`, ...) and offers four screens: video (screen size, colour depth, level of detail, windowed or full screen), audio (music and effects volume,
 * speakers, PA assistance, radio), game (level of help, autosave interval) and online. The web app keeps the ones that mean something in a browser and adds the
 * Babylon.js rendering ones.
 */

/** The original's "Level Of Help Provided" (`GAMEPLAYOPTIONS_NOHELP` .. `MAXHELP`). Here it decides whether tooltips are shown. */
export type HelpLevel = "none" | "low" | "medium" | "max";
export const HELP_LEVELS: readonly HelpLevel[] = ["none", "low", "medium", "max"];

export interface Settings {
  /** Share of the window's pixels the 3D view renders (0.5 = half width and height). Babylon `engine.setHardwareScalingLevel(1 / renderScale)`. */
  renderScale: number;
  /** Texture sharpness at a slant (Babylon `anisotropicFilteringLevel`): 1, 2, 4, 8 or 16. Applies to the next world that is built. */
  anisotropy: number;
  /** Smooth jagged edges with an FXAA post-process (a cheap full-screen pass). */
  smoothEdges: boolean;
  /** The browser's own multisampling (MSAA) on the canvas: sharper edges, a lot more GPU work. Read when the page loads. */
  multisampling: boolean;
  /** Smooth animation: sample the 10-frames-a-second clips with a cubic curve through four frames instead of the original's straight blend of two. Not what the original does. */
  smoothAnimation: boolean;
  /** Show the frames-per-second counter in the game view. */
  showFps: boolean;
  /** How much help the game gives; "none" turns the tooltips off. */
  helpLevel: HelpLevel;
  /** Music level, 0 to 1 in steps of 0.1: the original's mixer channel 1 (`Audio_AdjustVolume`, registry `Volume 1`, default 1). */
  musicVolume: number;
  /** Sound-effects level, same steps: mixer channel 2 (`Volume 2`, default 1). */
  soundVolume: number;
  /**
   * The rest of the mix (docs/AUDIO.md, "Does the music duck?"). The original has only the two volumes above: speech and ambience voices sit at the sound-effects volume and
   * the music is its own channel, so these four are the port's own stages, set by ear and all changeable here and in the dev menu.
   */
  /** DJ and news clips' gain: 1.6 is the radio effect's make-up gain (`radioeffect.ini`), 0 to 4. */
  speechVolume: number;
  /** Tannoy clips' gain: 0.5 is the volume `Audio_QueueTannoy` passes, 0 to 4. */
  tannoyVolume: number;
  /** The ambience (birds, bells, planes) against the other sound effects, 0 to 1. [guess] 0.1: at the sound-effects volume the birds covered the news. */
  ambienceVolume: number;
  /** How far the music drops while a DJ, news or tannoy clip plays, 0 to 1; 1 is none, as the original. */
  musicDuck: number;
  /** Loading screens built from a 3D character in front of a plain colour (`loadingScenes.ts`) instead of the original's pictures. Not what the original does. */
  newLoadingScreens: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = { renderScale: 1, anisotropy: 4, smoothEdges: true, multisampling: false, smoothAnimation: false, showFps: false, helpLevel: "max", musicVolume: 1, soundVolume: 1, speechVolume: 1.6, tannoyVolume: 0.5, ambienceVolume: 0.1, musicDuck: 1, newLoadingScreens: false };

export const ANISOTROPY_CHOICES = [1, 2, 4, 8, 16] as const;
/** The volume steps the original's buttons make (`ExternMusicVolUp` and friends: +-0.1). */
export const VOLUME_STEP = 0.1;
export const RENDER_SCALE_RANGE = { min: 0.5, max: 1.5, step: 0.25 } as const;

/** A volume clamped to 0..1 and snapped to the tenths the original's buttons give. */
function volume(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) / VOLUME_STEP) / Math.round(1 / VOLUME_STEP);
}

/** The mix stages that are not the original's volumes: their range and step (the options screen and the dev menu's sliders). */
export const MIX_RANGES = {
  speechVolume: { min: 0, max: 4, step: 0.05 },
  tannoyVolume: { min: 0, max: 4, step: 0.05 },
  ambienceVolume: { min: 0, max: 1, step: 0.05 },
  musicDuck: { min: 0, max: 1, step: 0.05 },
} as const;

function level(v: number, key: keyof typeof MIX_RANGES): number {
  const { min, max, step } = MIX_RANGES[key];
  return Math.round(Math.min(max, Math.max(min, v)) / step) * step;
}

/** Read settings from untrusted stored data: unknown or out-of-range values fall back to the defaults, numbers are clamped and snapped to what the screen offers. */
export function normalizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const { min, max, step } = RENDER_SCALE_RANGE;
  const scale = Math.round(Math.min(max, Math.max(min, num(o.renderScale, d.renderScale))) / step) * step;
  const aniso = num(o.anisotropy, d.anisotropy);
  return {
    renderScale: scale,
    anisotropy: (ANISOTROPY_CHOICES as readonly number[]).includes(aniso) ? aniso : d.anisotropy,
    smoothEdges: typeof o.smoothEdges === "boolean" ? o.smoothEdges : d.smoothEdges,
    multisampling: typeof o.multisampling === "boolean" ? o.multisampling : d.multisampling,
    smoothAnimation: typeof o.smoothAnimation === "boolean" ? o.smoothAnimation : d.smoothAnimation,
    showFps: typeof o.showFps === "boolean" ? o.showFps : d.showFps,
    helpLevel: HELP_LEVELS.includes(o.helpLevel as HelpLevel) ? (o.helpLevel as HelpLevel) : d.helpLevel,
    musicVolume: volume(num(o.musicVolume, d.musicVolume)),
    soundVolume: volume(num(o.soundVolume, d.soundVolume)),
    speechVolume: level(num(o.speechVolume, d.speechVolume), "speechVolume"),
    tannoyVolume: level(num(o.tannoyVolume, d.tannoyVolume), "tannoyVolume"),
    ambienceVolume: level(num(o.ambienceVolume, d.ambienceVolume), "ambienceVolume"),
    musicDuck: level(num(o.musicDuck, d.musicDuck), "musicDuck"),
    newLoadingScreens: typeof o.newLoadingScreens === "boolean" ? o.newLoadingScreens : d.newLoadingScreens,
  };
}

/** Where settings are kept: the browser's `localStorage`, or anything with these two methods (tests). */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = "otm.settings.v1";

/** The settings in use, with change notification. */
export class SettingsStore {
  private current: Settings;
  private readonly storage: SettingsStorage | null;
  private readonly listeners = new Set<(s: Settings) => void>();

  constructor(storage: SettingsStorage | null) {
    this.storage = storage;
    let raw: unknown = null;
    try {
      const text = storage?.getItem(KEY);
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = null; // unreadable storage or damaged JSON: start from the defaults
    }
    this.current = normalizeSettings(raw);
  }

  get(): Readonly<Settings> { return this.current; }

  /** Change some settings: the result is normalised, stored and announced. */
  set(change: Partial<Settings>): void {
    this.current = normalizeSettings({ ...this.current, ...change });
    try { this.storage?.setItem(KEY, JSON.stringify(this.current)); } catch { /* storage full or blocked: the setting still holds for this visit */ }
    for (const l of this.listeners) l(this.current);
  }

  reset(): void { this.set({ ...DEFAULT_SETTINGS }); }

  /** Call `listener` after every change; returns the function that stops it. */
  subscribe(listener: (s: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
