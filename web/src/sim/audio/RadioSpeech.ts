import { parseCsv } from "../../formats/Csv.ts";

/**
 * What the radio says between the music (docs/AUDIO.md, "The DJ, the news and the speech queue"): the DJ's chatter over the tracks, the news about the
 * timeline's historical events, and the queue that lets one clip at a time through. Plain data and rules; the sound is `audio/SpeechPlayer.ts`.
 */

/** One row of `radiostinginfo.csv`: a DJ clip tag, the years it is valid in, and whether it is picked at random among the tag's clips. */
export interface DjEntry {
  tag: string;
  startYear: number;
  endYear: number;
  random: boolean;
}

export function parseDjSchedule(text: string): DjEntry[] {
  const rows = parseCsv(text);
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (n: string) => head.indexOf(n);
  const out: DjEntry[] = [];
  for (const row of rows.slice(1)) {
    const tag = (row[col("criteria")] ?? "").trim();
    if (!tag) continue;
    out.push({ tag, startYear: Number(row[col("start")]), endYear: Number(row[col("end")]), random: Number(row[col("random")]) !== 0 });
  }
  return out;
}

/** The DJ clip tags in force in a year. `talk` is the chatter tag; `intro` and `outro` are single announcements some DJs have. */
export interface DjForYear {
  talk?: string;
  intro?: string;
  outro?: string;
}

/** The DJ for a game year: McDuff to 1940, Krunkleburger 1941-1955, and so on (`radiostinginfo.csv`). */
export function djForYear(entries: readonly DjEntry[], year: number): DjForYear {
  const out: DjForYear = {};
  for (const e of entries) {
    if (year < e.startYear || year > e.endYear) continue;
    if (e.tag.endsWith("_INTRO")) out.intro ??= e.tag;
    else if (e.tag.endsWith("_OUTRO")) out.outro ??= e.tag;
    else out.talk ??= e.tag;
  }
  return out;
}

/**
 * Whether the DJ may speak now, over the track being played. orig: `AudioState_UpdateRadioMusic` (0x004F8AE0): once per track, when the playback position
 * (as a fraction of the track) is past the track's `DJ_STING` cue and before one half, and a roll of 0..5 comes up 0..4: five chances in six.
 * [guess] The position is a fraction: the code compares it with 0.5 and with the cue, and the cue is 5 to 7 s into tracks two minutes long.
 */
export function djMaySpeak(fraction: number, cueFraction: number, roll: number): boolean {
  return fraction > cueFraction && fraction < 0.5 && roll < 5;
}

/** A historical event on the timeline: `timeline.csv` rows named `timeline_<NAME>` with a decimal year. The news bank has a clip tagged `TIMELINE_<NAME>`. */
export interface TimelineEvent {
  /** The bank tag, upper case: `TIMELINE_BAYOFPIGS`. */
  tag: string;
  year: number;
}

export function parseTimelineEvents(text: string): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const row of parseCsv(text)) {
    const name = (row[0] ?? "").trim();
    if (!/^timeline_/i.test(name)) continue;
    const year = Number(row[1]);
    if (Number.isFinite(year)) out.push({ tag: name.toUpperCase(), year });
  }
  return out;
}

/** Years before an event that its "_FUTURE" news is read, and how long the window lasts. orig: `WTimelineEventIcon_Update` (0x007A3D60): `Time_FromYears(2.0)` and `0.5`. */
export const FUTURE_NEWS_LEAD_YEARS = 2;
export const NEWS_WINDOW_YEARS = 0.5;

/**
 * Which news clips are due at a game date. The "_FUTURE" clip is read once when the date is between two years and one and a half before the event, the
 * clip itself once when it is within half a year after. A clip the bank does not have is never asked for (the original's engine finds no sample either).
 */
export class NewsAnnouncer {
  private readonly events: readonly TimelineEvent[];
  private readonly hasTag: (tag: string) => boolean;
  private readonly done = new Set<string>();

  constructor(events: readonly TimelineEvent[], hasTag: (tag: string) => boolean) {
    this.events = events;
    this.hasTag = hasTag;
  }

  /** The tags to queue at `year` (a decimal game year), each at most once. */
  due(year: number): string[] {
    const out: string[] = [];
    for (const e of this.events) {
      const future = `${e.tag}_FUTURE`;
      const lead = e.year - FUTURE_NEWS_LEAD_YEARS;
      if (year >= lead && year - lead <= NEWS_WINDOW_YEARS && !this.done.has(future)) {
        this.done.add(future);
        if (this.hasTag(future)) out.push(future);
      }
      if (year >= e.year && year - e.year <= NEWS_WINDOW_YEARS && !this.done.has(e.tag)) {
        this.done.add(e.tag);
        if (this.hasTag(e.tag)) out.push(e.tag);
      }
    }
    return out;
  }
}

export type SpeechCategory = "dj" | "news" | "tannoy" | "speech";
/** The category numbers the original uses (clip `+0x44`): the index into the speech levels. */
export const SPEECH_CATEGORY_INDEX: Record<SpeechCategory, number> = { dj: 0, news: 1, tannoy: 2, speech: 3 };

export interface SpeechClip {
  /** The bank tag to play: `RADIO_DJ_MADDOG`, `TIMELINE_WW2ENDS_FUTURE`. */
  tag: string;
  category: SpeechCategory;
  /** 1 (most important) to 4: the queue it waits in. */
  priority: number;
}

/** The speech levels the Options screen sets (registry `DJLevel`, `NewsLevel`, ...; default 3). A clip plays when its priority is at most the level of its category; -1 is off. */
export type SpeechLevels = Record<SpeechCategory, number>;
export const DEFAULT_SPEECH_LEVELS: Readonly<SpeechLevels> = { dj: 3, news: 3, tannoy: 3, speech: 3 };

/** The game must have run this many ticks before news or tannoy clips are accepted (`*DAT_00F87B04 < 300` in `Audio_QueueSpeech`): 30 s at the original's 10 Hz. */
export const MIN_TICKS_FOR_ANNOUNCEMENTS = 300;
/** The pause the radio leaves after one clip before the next may start (`DAT_00E51CD4`, 5000 ms). */
export const SPEECH_GAP_MS = 5000;

/**
 * Four priority queues in front of one voice. orig: `Audio_QueueSpeech` (0x004F87C0) refuses a clip that is already waiting, whose category is off, whose level is
 * below its priority, or (news, tannoy) that comes too early in the game; `RadioChannel_SelectNextClip` (0x004F6ED0) takes the first clip of the lowest-numbered
 * queue once the gap since the last clip has passed.
 */
export class SpeechQueue {
  levels: SpeechLevels;
  private readonly queues: SpeechClip[][] = [[], [], [], [], []];

  constructor(levels: SpeechLevels = { ...DEFAULT_SPEECH_LEVELS }) {
    this.levels = levels;
  }

  get length(): number {
    return this.queues.reduce((n, q) => n + q.length, 0);
  }

  /** Queue a clip; returns whether it was accepted. */
  queue(clip: SpeechClip, gameTicks: number): boolean {
    const level = this.levels[clip.category];
    if (level === -1 || level < clip.priority) return false;
    if ((clip.category === "news" || clip.category === "tannoy") && gameTicks < MIN_TICKS_FOR_ANNOUNCEMENTS) return false;
    if (clip.priority < 0 || clip.priority > 4) return false;
    if (this.queues.some((q) => q.some((c) => c.tag === clip.tag))) return false;
    this.queues[clip.priority]!.push(clip);
    return true;
  }

  /** The next clip to play, if the gap since the last clip ended has passed (`sinceLastEndMs`). It is removed from its queue. */
  next(sinceLastEndMs: number): SpeechClip | undefined {
    if (sinceLastEndMs < SPEECH_GAP_MS) return undefined;
    for (const q of this.queues) {
      const i = q.findIndex((c) => this.levels[c.category] >= c.priority);
      if (i >= 0) return q.splice(i, 1)[0];
    }
    return undefined;
  }
}

/**
 * Which clip of a tag plays next: a shuffle bag. orig: `RadioSting_LoadCurrentClipList` (0x0043DBE0) lists the indices 0..n-1 of the DJ's clips and
 * `RadioSting_TakeClipIndex` (0x0043D980) removes one at random each time, so a clip does not repeat until the others have played; the bag is refilled when empty.
 */
export class ClipBag {
  private readonly bags = new Map<string, number[]>();
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  /** The next clip index (0..count-1) for `tag`, or -1 when it has no clips. */
  take(tag: string, count: number): number {
    if (count <= 0) return -1;
    let bag = this.bags.get(tag);
    if (!bag || bag.length === 0) {
      bag = Array.from({ length: count }, (_, i) => i);
      this.bags.set(tag, bag);
    }
    const i = Math.min(bag.length - 1, Math.floor(this.random() * bag.length));
    return bag.splice(i, 1)[0]!;
  }
}
