import { parseCsv } from "../../formats/Csv.ts";

/**
 * The in-game radio's music library and playlist (docs/AUDIO.md, "The music library").
 *
 * `trackinfo.csv` lists the music: one row per track with the years it plays in, its volume, a weight per genre and three flags. The original loads it into
 * 200-byte records (`TrackInfo_LoadCsv`, orig: 0x00487EF0). `RadioPlaylist_Fill` (orig: 0x00487420) adds every track whose years include the game's year and
 * whose "Put on Radio" flag is set; `RadioPlaylist_PurgeOutOfYear` (orig: 0x00487220) drops the ones the year has passed. The next track is taken at random from
 * what is left and removed (`FUN_0043D980` with its random flag), so a track is not repeated until the others have played.
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
  /** A weight per genre, 0 to 1. What they are used for is not decoded; the radio here ignores them. */
  genres: Record<(typeof GENRES)[number], number>;
  /** "Play in Random Mode" (a record flag the radio fill reads when asked for mode 1; its meaning is not known). */
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

/** Read a `.cue` file: `//` comment lines and `"NAME" = value` lines. Values are milliseconds [guess: `NEXT_MUSIC_START` is 2.5 to 5 s before the end of every track checked]. */
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

export interface RadioOptions {
  /** A random number in [0, 1), `Math.random` by default. */
  random?: () => number;
  /** Play the tracks flagged "first in new game" before any other (a new game). */
  preferFirst?: boolean;
}

/** What plays next on the radio for a given game year. */
export class RadioPlaylist {
  private readonly tracks: readonly TrackInfo[];
  private readonly random: () => number;
  private readonly preferFirst: boolean;
  private readonly played = new Set<string>();
  private last: string | null = null;

  constructor(tracks: readonly TrackInfo[], options: RadioOptions = {}) {
    this.tracks = tracks;
    this.random = options.random ?? Math.random;
    this.preferFirst = options.preferFirst ?? false;
  }

  /** The tracks the radio may play in `year`. */
  eligible(year: number): TrackInfo[] {
    return this.tracks.filter((t) => t.onRadio && t.startYear <= year && year <= t.endYear);
  }

  /** The next track for `year`, or undefined when no track plays in that year. */
  next(year: number): TrackInfo | undefined {
    const eligible = this.eligible(year);
    if (eligible.length === 0) return undefined;
    let bag = eligible.filter((t) => !this.played.has(t.name));
    if (bag.length === 0) {
      // every track has played: start a new round, but not with the one that just finished
      this.played.clear();
      bag = eligible.length > 1 ? eligible.filter((t) => t.name !== this.last) : eligible;
    }
    if (this.preferFirst) {
      const first = bag.filter((t) => t.playFirst);
      if (first.length) bag = first;
    }
    const pick = bag[Math.min(bag.length - 1, Math.floor(this.random() * bag.length))]!;
    this.played.add(pick.name);
    this.last = pick.name;
    return pick;
  }
}
