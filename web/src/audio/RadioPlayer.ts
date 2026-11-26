import { parseCues, parseTrackInfo, RadioPlaylist, type TrackCues, type TrackInfo } from "../sim/audio/Radio.ts";
import { djMaySpeak } from "../sim/audio/RadioSpeech.ts";

/** What the radio needs from the audio manager. */
export interface RadioHost {
  /** The Web Audio context and the bus the music goes to. */
  graph(): { context: AudioContext; bus: GainNode } | null;
  /** URL of a file under `Data/Audio/` (`music/Adagio.ogg`, `trackinfo.csv`), or null when it cannot be read. */
  locate(path: string): string | null;
  /** The game's current year, read when each track is chosen. */
  year(): number;
  /** A new game starts with the tracks flagged to play first. */
  newGame(): boolean;
  /** The DJ may talk over the current track. */
  djChatter(): void;
}

const FADE_SECONDS = 1.2;
/** After this many tracks in a row that fail to load the radio gives up (a missing or blocked folder would otherwise loop). */
const MAX_FAILURES = 4;

interface Playing {
  track: TrackInfo;
  element: HTMLAudioElement;
  gain: GainNode;
  cues: TrackCues;
  /** The next track has been started (at the cue or at the end), so this one only plays out. */
  advanced: boolean;
  /** The DJ roll for this track has been made. */
  djRolled: boolean;
  /** What became of the DJ's chance on this track, for the dev menu. */
  djNote: string;
}

/**
 * The in-game radio (audio state 2, docs/AUDIO.md): plays the music library's tracks for the game's year one after another. The next track starts at the
 * track's `NEXT_MUSIC_START` cue, with the old one fading out under it, or when the old one ends if it has no cue. It tells the speech player when the DJ may talk over a track (the DJ and news themselves are `SpeechPlayer`).
 * It is what `AudioState_UpdateRadioMusic` (orig: 0x004F8AE0) does per frame in the original.
 */
export class RadioPlayer {
  private readonly host: RadioHost;
  private playlist: RadioPlaylist | null = null;
  private loading: Promise<void> | null = null;
  private current: Playing | null = null;
  private wanted = false;
  private failures = 0;
  private tracks: TrackInfo[] = [];

  private readonly mode: "radio" | "frontEnd";
  /** Dev menu: the DJ roll always comes up "speak" (the window still applies). */
  forceDj = false;

  /** `mode` "frontEnd" is the menus' player: the random-mode tracks of any year, and no DJ (`AudioState_UpdateFrontEndMusic`, orig: 0x004F5E80). */
  constructor(host: RadioHost, options: { mode?: "radio" | "frontEnd" } = {}) {
    this.host = host;
    this.mode = options.mode ?? "radio";
  }

  get isWanted(): boolean {
    return this.wanted;
  }

  /** Start, or carry on where it was suspended. */
  play(): void {
    this.wanted = true;
    const g = this.host.graph();
    if (!g) return;
    if (this.current) this.fadeIn(this.current, g);
    else void this.playNext();
  }

  /** Dev menu: what is playing and what the DJ's chance on it is. */
  debugRows(): Record<string, string> {
    const c = this.current;
    if (!c) return { track: this.wanted ? "none yet" : "radio not running" };
    const len = c.element.duration;
    const known = Number.isFinite(len) && len > 0;
    const cue = c.cues.djSting === undefined ? "none (no DJ on this track)" : known ? `${(c.cues.djSting / 1000 / len).toFixed(3)} (${(c.cues.djSting / 1000).toFixed(1)} s)` : `${(c.cues.djSting / 1000).toFixed(1)} s`;
    return {
      track: c.track.name,
      position: known ? `${c.element.currentTime.toFixed(1)} / ${len.toFixed(1)} s (${(c.element.currentTime / len).toFixed(3)})` : "loading",
      "DJ_STING (fraction)": cue,
      "DJ window": "past the cue and before 0.5",
      "DJ on this track": c.djNote,
    };
  }

  /** Dev menu: move on to the next track now (the old one fades out under it). */
  skip(): void {
    if (!this.current || !this.wanted) return;
    this.current.advanced = true;
    void this.playNext();
  }

  /** Fade out and pause; `play` resumes the same track. */
  pause(): void {
    this.wanted = false;
    const cur = this.current;
    const g = this.host.graph();
    if (!cur) return;
    if (g) this.ramp(cur.gain, 0, g.context);
    window.setTimeout(() => { if (!this.wanted) cur.element.pause(); }, FADE_SECONDS * 1000);
  }

  /** Stop for good and release the audio element. */
  dispose(): void {
    this.wanted = false;
    this.release(this.current);
    this.current = null;
  }

  private async ensurePlaylist(): Promise<RadioPlaylist | null> {
    if (this.playlist) return this.playlist;
    this.loading ??= (async () => {
      const url = this.host.locate("trackinfo.csv");
      if (!url) return;
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        // the file is plain ASCII; decode as Latin-1 like the game's other text files
        this.tracks = parseTrackInfo(new TextDecoder("latin1").decode(await res.arrayBuffer()));
        this.playlist = new RadioPlaylist(this.tracks, { preferFirst: this.mode === "radio" && this.host.newGame(), mode: this.mode });
      } catch { /* no library: the radio stays silent */ }
    })();
    await this.loading;
    return this.playlist;
  }

  private async playNext(): Promise<void> {
    const playlist = await this.ensurePlaylist();
    const g = this.host.graph();
    if (!playlist || !g || !this.wanted) return;
    const track = playlist.next(this.host.year());
    if (!track) return;
    const url = this.host.locate(`music/${track.name}.ogg`);
    if (!url) return;
    const cues = await this.fetchCues(track.name);
    if (!this.wanted) return; // paused while the cue file loaded; the next play() chooses again
    const element = new Audio(url);
    element.preload = "auto";
    const gain = g.context.createGain();
    gain.gain.value = 0;
    g.context.createMediaElementSource(element).connect(gain);
    gain.connect(g.bus);
    const now: Playing = { track, element, gain, cues, advanced: false, djRolled: false, djNote: cues.djSting === undefined ? "no cue: never" : "waiting for the window" };
    const previous = this.current;
    this.current = now;
    const advance = () => {
      if (now.advanced) return;
      now.advanced = true;
      if (this.current === now && this.wanted) void this.playNext();
    };
    element.addEventListener("timeupdate", () => {
      // the DJ's chance to talk: once per track, past its DJ_STING cue and before half way (`djMaySpeak`). A track without the cue has its fraction at 1,
      // so its window never opens (`TrackInfo_LoadCsv`, orig: 0x00487EF0; the window's end is the constant 0.5 at 0x00D1694C)
      const length = element.duration;
      if (this.mode === "radio" && !now.djRolled && Number.isFinite(length) && length > 0) {
        const fraction = element.currentTime / length;
        const cueFraction = cues.djSting === undefined ? 1 : cues.djSting / 1000 / length;
        if (fraction > cueFraction && fraction < 0.5) {
          now.djRolled = true;
          const roll = this.forceDj ? 0 : Math.floor(Math.random() * 6);
          const speak = djMaySpeak(fraction, cueFraction, roll);
          now.djNote = speak ? `rolled ${roll}: queued the DJ${this.forceDj ? " (forced)" : ""}` : `rolled ${roll} (5 is silent): no DJ`;
          if (speak) this.host.djChatter();
        } else if (fraction >= 0.5 && !now.djRolled && cues.djSting !== undefined) {
          now.djRolled = true;
          now.djNote = "window missed (first check came past one half)";
        }
      }
      if (cues.nextMusicStart !== undefined && element.currentTime * 1000 >= cues.nextMusicStart) advance();
    });
    element.addEventListener("ended", () => { advance(); this.release(now); });
    element.addEventListener("error", () => {
      this.release(now);
      if (this.current === now) this.current = null;
      if (++this.failures < MAX_FAILURES) void this.playNext();
    });
    element.play().then(() => { this.failures = 0; }).catch(() => { /* not allowed yet: unlock() calls play() again */ });
    this.fadeIn(now, g);
    if (previous && previous !== now) {
      // the old track plays out under the new one, fading away
      previous.advanced = true;
      this.ramp(previous.gain, 0, g.context, Math.max(FADE_SECONDS, 3));
      window.setTimeout(() => this.release(previous), Math.max(FADE_SECONDS, 3) * 1000 + 100);
    }
  }

  private async fetchCues(name: string): Promise<TrackCues> {
    const url = this.host.locate(`music/cues/${name}.cue`);
    if (!url) return {};
    try {
      const res = await fetch(url);
      return res.ok ? parseCues(await res.text()) : {};
    } catch {
      return {};
    }
  }

  private fadeIn(p: Playing, g: { context: AudioContext }): void {
    void p.element.play().catch(() => {});
    this.ramp(p.gain, p.track.volume, g.context);
  }

  private ramp(gain: GainNode, to: number, context: AudioContext, seconds = FADE_SECONDS): void {
    const t = context.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(to, t + seconds);
  }

  private release(p: Playing | null): void {
    if (!p) return;
    if (this.current === p) this.current = null; // a finished track must not be "resumed" later
    p.element.pause();
    p.element.removeAttribute("src");
    p.element.load();
    p.gain.disconnect();
  }
}
