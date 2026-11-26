import { parseCsv } from "../../formats/Csv.ts";

/**
 * The in-game radio's music library and playlist (docs/AUDIO.md, "The music library").
 *
 * `trackinfo.csv` lists the music: one row per track with the years it plays in, its volume, a weight per genre and three flags. The original loads it into
 * 200-byte records (`TrackInfo_LoadCsv`, orig: 0x00487EF0). `RadioPlaylist_Fill` (orig: 0x00487420) adds every track whose years include the game's year and
 * whose "Put on Radio" flag is set; `RadioPlaylist_PurgeOutOfYear` (orig: 0x00487220) drops the ones the year has passed. `RadioPlaylist` below is the pick.
 */

export const GENRES = ["Action", "Comedy", "Horror", "Romance", "Scifi", "Thriller", "War", "Western"] as const;

export interface TrackInfo {
  /** The track's name; its file is `Data/Audio/music/<name>.ogg` (any letter case). */
  name: string;
  /** The first and last game year it plays in (end 10000 = no end). */
  startYear: number;
  endYear: number;
  /** "Put on Radio": whether the radio plays it. */
  onRadio: boolean;
  /** The level it plays at, 0 to 1 (0.45 for most). */
  volume: number;
  /** A weight per genre, 0 to 1 (record `+0x90..+0xAC`). The radio's pick does not read them (`RadioPlaylist`). */
  genres: Record<(typeof GENRES)[number], number>;
  /** "Play in Random Mode" (record `+0xC5`): the tracks the front end's (menu) player picks from, any year. Only `Relaxing_By_The_Sea` has it. */
  randomMode: boolean;
  /** "Play these songs first in new game". */
  playFirst: boolean;
}

/** Read `trackinfo.csv`. Columns are found by their header names; rows without a track name are skipped. */
export function parseTrackInfo(text: string): TrackInfo[] {
  const rows = parseCsv(text);
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name.toLowerCase());
  const c = { track: col("Track"), start: col("Start"), end: col("End"), radio: col("Put on Radio"), volume: col("Volume"), random: col("Play in Random Mode"), first: col("Play these songs first in new game") };
  const out: TrackInfo[] = [];
  for (const row of rows.slice(1)) {
    const name = (row[c.track] ?? "").trim();
    if (!name) continue;
    const num = (i: number) => (i >= 0 && row[i] !== undefined && row[i].trim() !== "" ? Number(row[i]) : 0);
    const genres = {} as TrackInfo["genres"];
    for (const g of GENRES) genres[g] = num(col(g));
    out.push({ name, startYear: num(c.start), endYear: num(c.end), onRadio: num(c.radio) !== 0, volume: num(c.volume), genres, randomMode: num(c.random) !== 0, playFirst: num(c.first) !== 0 });
  }
  return out;
}

/** The marks in a track's `music/cues/<name>.cue` file, in milliseconds from the start of the track. */
export interface TrackCues {
  /** `NEXT_MUSIC_START`: when the next track should begin (a little before this one ends). */
  nextMusicStart?: number;
  /** `DJ_STING`: when the DJ's sting can play over the track. */
  djSting?: number;
}

/** Read a `.cue` file: `//` comment lines and `"NAME" = value` lines. Values are milliseconds from the start of the track [read: `TrackInfo_LoadCsv` divides each by the track's length in ms to make the fractions it compares the playback position with]. */
export function parseCues(text: string): TrackCues {
  const cues: TrackCues = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*"([A-Za-z_]+)"\s*=\s*(\d+)/.exec(line);
    if (!m) continue;
    if (m[1] === "NEXT_MUSIC_START") cues.nextMusicStart = Number(m[2]);
    else if (m[1] === "DJ_STING") cues.djSting = Number(m[2]);
  }
  return cues;
}

/** The no-repeat window the original gives the in-game radio: a track is skipped while fewer than this many tracks have started since it last played (`DAT_00E50E8C`, 7 in the data section; orig: 0x00487530). */
export const RADIO_MIN_SEPARATION = 7;

export interface RadioOptions {
  /** A random number in [0, 1), `Math.random` by default. */
  random?: () => number;
  /** A new game: the first fill takes only the tracks flagged "play first". */
  preferFirst?: boolean;
  /** How many other tracks must have started before one may play again (default `RADIO_MIN_SEPARATION`). */
  minSeparation?: number;
  /**
   * Which player's playlist this is. "radio" (the default) is the in-game radio: tracks with "Put on Radio" whose years include the game year.
   * "frontEnd" is the menu player (`FUN_00446600`, orig: 0x00446600): tracks with "Play in Random Mode", any year.
   */
  mode?: "radio" | "frontEnd";
}

/**
 * What plays next. The original keeps one playlist of "queued" tracks (`DAT_0104A59C`) that it fills from the library and empties by picking:
 *
 * - `RadioPlaylist_Fill` (orig: 0x00487420) queues every track that fits (year inside Start..End, the mode's flag set, not queued already; on a new game's first
 *   fill only the "play first" ones), `RadioPlaylist_PurgeOutOfYear` (orig: 0x00487220) unqueues those the year has passed. A year change purges and fills
 *   (`RadioPlayer_SetYear`, orig: 0x0049AA30). The queue is filled again whenever it is found empty (`FUN_0049AB80`).
 * - `FUN_00487530` (orig: 0x00487530) picks the next track: a uniformly random entry of the queue. If that track last started fewer than the separation
 *   (7 for the radio) picks ago, it is dropped from this round's candidates and another is drawn; if every candidate is too recent, nothing plays this time.
 *   The pick leaves the queue, is stamped with the running play counter and the counter goes up. The genre weights in the CSV are not read here.
 *
 * quirk: with seven or fewer tracks in a year the original can find every queued track too recent and play nothing until the year changes. The shipped
 *   library never has fewer than eight on the radio from 1920 on (1920 to 1929 have exactly eight), so this is not reachable in a game.
 */
export class RadioPlaylist {
  private readonly tracks: readonly TrackInfo[];
  private readonly random: () => number;
  private readonly minSeparation: number;
  private readonly mode: "radio" | "frontEnd";
  private queue: TrackInfo[] = [];
  private readonly lastPlayed = new Map<TrackInfo, number>();
  private playCounter = 0;
  private firstPending: boolean;
  private year: number | null = null;

  constructor(tracks: readonly TrackInfo[], options: RadioOptions = {}) {
    this.tracks = tracks;
    this.random = options.random ?? Math.random;
    this.firstPending = options.preferFirst ?? false;
    this.mode = options.mode ?? "radio";
    this.minSeparation = options.minSeparation ?? (this.mode === "radio" ? RADIO_MIN_SEPARATION : 0);
  }

  private fits(t: TrackInfo, year: number | null): boolean {
    const flag = this.mode === "radio" ? t.onRadio : t.randomMode;
    return flag && (year === null || (t.startYear <= year && year <= t.endYear));
  }

  /** The tracks the radio may play in `year` (the front-end player ignores the year). */
  eligible(year: number): TrackInfo[] {
    return this.tracks.filter((t) => this.fits(t, this.mode === "radio" ? year : null));
  }

  private fill(year: number | null, onlyFirst: boolean): void {
    for (const t of this.tracks) {
      if (this.fits(t, year) && (!onlyFirst || t.playFirst) && !this.queue.includes(t)) this.queue.push(t);
    }
  }

  /** The next track for `year`, or undefined when none plays (no track fits the year, or all are too recent). */
  next(year: number): TrackInfo | undefined {
    const fitYear = this.mode === "radio" ? year : null;
    if (this.mode === "radio" && this.year !== year) {
      // the year changed (or this is the first call): drop what no longer fits, add what now does
      this.year = year;
      this.queue = this.queue.filter((t) => t.startYear <= year && year <= t.endYear);
      this.fill(fitYear, this.firstPending);
      this.firstPending = false;
    }
    if (this.queue.length === 0) {
      this.fill(fitYear, this.firstPending);
      this.firstPending = false;
    }
    const candidates = this.queue.slice();
    while (candidates.length > 0) {
      const at = Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length));
      const track = candidates[at]!;
      const last = this.lastPlayed.get(track);
      if (last === undefined || this.minSeparation <= this.playCounter - last) {
        this.queue.splice(this.queue.indexOf(track), 1);
        this.lastPlayed.set(track, this.playCounter);
        this.playCounter++;
        return track;
      }
      candidates.splice(at, 1);
    }
    return undefined;
  }
}
