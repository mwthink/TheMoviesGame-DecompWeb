import { HttpSource } from "../assets/ByteSource.ts";
import { decodeClip } from "./ClipDecoder.ts";
import { indexCriteria, openLug, readLugClip, type LugBank } from "../formats/Lug.ts";
import { ClipBag, djForYear, NewsAnnouncer, parseDjSchedule, parseTimelineEvents, SpeechQueue, type DjEntry, type DjForYear, type SpeechClip, type TimelineEvent } from "../sim/audio/RadioSpeech.ts";

/** What the speech player needs from the audio manager. */
export interface SpeechHost {
  graph(): { context: AudioContext; speechBus: GainNode } | null;
  locate(path: string): string | null;
  /** The game's date in days (365 to the year). */
  date(): number;
  /** Lower the music while a clip plays (true) and bring it back (false). */
  duck(on: boolean): void;
  /** The timeline's events (names and dates), once a game is loaded. */
  events(): readonly TimelineEvent[];
  /** A news clip started (its tag) or ended (null): the timeline lights the icon of the event it is about. */
  onNews?(tag: string | null): void;
}

/** The radio's voice filter, from `Data/Audio/radioeffect.ini` `[radio]`: a band-pass at 1548 Hz, Q 5, with make-up gain 1.6. */
const RADIO_FILTER = { frequency: 1548, q: 5, gain: 1.6 };

/** The tannoy's PA effect, from `radioeffect.ini` `[tannoy]`: a 151 ms echo mixed in at 0.45 over the dry voice (1.0), through a band-pass at 1587 Hz, Q 1.8. [guess] The order of the stages and a single echo without feedback. */
const TANNOY_FILTER = { delayMs: 151, wet: 0.45, dry: 1.0, frequency: 1587, q: 1.8 };
/** A tannoy clip's volume: `Audio_QueueTannoy` (orig: 0x004F8A00) passes 0.5. */
const TANNOY_VOLUME = 0.5;

/** The header of a clip's bytes, for the dev menu when the browser cannot decode it: the length, the first four bytes and the WAVE format fields. */
function describeWav(b: Uint8Array): string {
  const ascii = (o: number) => String.fromCharCode(...b.subarray(o, o + 4));
  if (b.byteLength < 36) return `${b.byteLength} bytes`;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return `${b.byteLength} bytes, "${ascii(0)}" riff size ${dv.getUint32(4, true)}, "${ascii(8)}", format tag 0x${dv.getUint16(20, true).toString(16)}, ${dv.getUint16(22, true)} ch, ${dv.getUint32(24, true)} Hz, ${dv.getUint16(34, true)} bit`;
}

interface Banks {
  dj: LugBank | null;
  news: LugBank | null;
  /** `speech_tannoy.lug` and its add-on bank: a tag is looked up in each. */
  tannoy: LugBank[];
  schedule: DjEntry[];
}

/**
 * The radio's talk: the DJ's chatter over the music and the news about the timeline's events, one clip at a time through the speech queue
 * (`sim/audio/RadioSpeech.ts`). Clips come from the speech banks `EN-UK/speech_dj.lug` and `speech_news.lug`, are picked at random among the samples of a tag,
 * and are played through the radio filter. The tannoy and the other speech categories are not done.
 */
export class SpeechPlayer {
  private readonly host: SpeechHost;
  private banks: Promise<Banks> | null = null;
  private readonly queue = new SpeechQueue();
  private announcer: NewsAnnouncer | null = null;
  private announcerFor: readonly TimelineEvent[] | null = null;
  private timer = 0;
  private playing = false;
  private lastEnd = -Infinity;
  private runningMs = 0;
  private lastTick = 0;
  private currentDj: DjForYear | null = null;
  private readonly clips = new ClipBag();
  /** Dev menu: let clips through without the 30 s game-age rule and the 5 s gap. */
  ignoreLimits = false;
  private loadedBanks: Banks | null = null;
  private note = "none yet";

  constructor(host: SpeechHost) {
    this.host = host;
  }

  /** The radio is on: watch the date and let clips through. */
  start(): void {
    if (this.timer) return;
    this.lastTick = performance.now();
    // the 5 s gap counts from here: the radio has just started or come back (after the loading screen), so the first clip waits as if one had just ended
    this.lastEnd = this.lastTick;
    this.timer = window.setInterval(() => void this.tick(), 1000);
  }

  /** Dev menu: the speech state, one row per fact. */
  debugRows(): Record<string, string> {
    const dj = this.currentDj;
    const count = dj?.talk && this.loadedBanks?.dj ? indexCriteria(this.loadedBanks.dj).get(dj.talk)?.length ?? 0 : 0;
    return {
      "speech timer": this.timer ? "running" : "stopped (radio not running)",
      banks: this.loadedBanks ? `dj ${this.loadedBanks.dj ? "yes" : "NO"}, news ${this.loadedBanks.news ? "yes" : "NO"}, tannoy ${this.loadedBanks.tannoy.length}, schedule ${this.loadedBanks.schedule.length} rows` : "not loaded yet",
      "DJ tag": dj?.talk ? `${dj.talk} (${count} clips)` : "none for this year",
      queued: String(this.queue.length),
      "clip playing": this.playing ? "yes" : "no",
      "since last clip": this.lastEnd === -Infinity ? "never" : `${((performance.now() - this.lastEnd) / 1000).toFixed(1)} s`,
      "game age": `${(this.runningMs / 1000).toFixed(0)} s`,
      "last event": this.note,
    };
  }

  /** Dev menu: the clip tags of a category, sorted. */
  async tagsOf(category: "dj" | "news" | "tannoy"): Promise<string[]> {
    const b = await this.banks_();
    const banks = category === "news" ? [b.news] : category === "tannoy" ? b.tannoy : [b.dj];
    const tags = new Set<string>();
    for (const bank of banks) if (bank) for (const t of indexCriteria(bank).keys()) tags.add(t);
    return [...tags].sort();
  }

  /** Dev menu: queue a clip now. Returns whether the queue accepted it. */
  playTag(category: "dj" | "news" | "tannoy", tag: string): boolean {
    const ok = this.queue.queue({ tag, category, priority: 1 }, this.ticks());
    this.note = ok ? `queued ${tag}` : `refused ${tag} (level, age or already waiting)`;
    return ok;
  }

  /** Dev menu: set a category's speech level (-1 off, 1..4). */
  setLevel(category: "dj" | "news" | "tannoy", level: number): void {
    this.queue.levels[category] = level;
  }

  private ticks(): number {
    return this.ignoreLimits ? Number.MAX_SAFE_INTEGER : this.runningMs / 100;
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  /** The DJ may talk over the current track (the roll and the position were checked by the radio). */
  djChatter(): void {
    void this.banks_().then((b) => {
      const dj = djForYear(b.schedule, Math.floor(this.host.date() / 365));
      if (!dj.talk) this.note = "DJ asked, but the schedule has no DJ for this year";
      else this.enqueue({ tag: dj.talk, category: "dj", priority: 1 });
    });
  }

  /**
   * A studio announcement (`Audio_QueueTannoy`, orig: 0x004F8A00): `TANNOY_CASTING_COMPLETE` and the like, queued by whatever happens in the studio. Refused like any
   * clip when the PA level is below `priority` or the game is under 30 s old. Take the priority from `TANNOY_CODE_PRIORITY` or `TANNOY_RULE_ACTIONS`; the default (2) is only a fallback.
   */
  tannoy(tag: string, priority = 2): boolean {
    return this.queue.queue({ tag, category: "tannoy", priority }, this.ticks());
  }

  /** Withdraw a waiting tannoy clip (`SpeechQueue.remove`): the casting nags go when the missing role is filled. */
  cancelTannoy(tag: string): boolean {
    return this.queue.remove(tag);
  }

  private enqueue(clip: SpeechClip): void {
    const ok = this.queue.queue(clip, this.ticks()); // ticks at the original's 10 Hz
    this.note = ok ? `queued ${clip.tag}` : `refused ${clip.tag} (level, age or already waiting)`;
  }

  private banks_(): Promise<Banks> {
    this.banks ??= (async () => {
      const open = async (file: string): Promise<LugBank | null> => {
        const url = this.host.locate(`EN-UK/${file}`);
        if (!url) return null;
        try { return await openLug(await HttpSource.open(file, url)); } catch { return null; }
      };
      let schedule: DjEntry[] = [];
      const csv = this.host.locate("radiostinginfo.csv");
      if (csv) {
        try { schedule = parseDjSchedule(await (await fetch(csv)).text()); } catch { /* no DJ schedule: no chatter */ }
      }
      const [dj, news, ...tannoy] = await Promise.all([open("speech_dj.lug"), open("speech_news.lug"), open("speech_tannoy.lug"), open("Speech_TANNOY_addon.lug")]);
      const loaded = { dj, news, tannoy: tannoy.filter((b): b is LugBank => b !== null), schedule };
      this.loadedBanks = loaded;
      return loaded;
    })();
    return this.banks;
  }

  private async tick(): Promise<void> {
    const now = performance.now();
    this.runningMs += now - this.lastTick;
    this.lastTick = now;
    const banks = await this.banks_();
    if (!this.timer) return; // the radio was stopped while the banks loaded
    const year = this.host.date() / 365;

    // a new DJ: the old one's sign-off, then the new one's introduction
    const dj = djForYear(banks.schedule, Math.floor(year));
    if (dj.talk && dj.talk !== this.currentDj?.talk) {
      if (this.currentDj && dj.outro) this.enqueue({ tag: dj.outro, category: "dj", priority: 1 });
      if (dj.intro) this.enqueue({ tag: dj.intro, category: "dj", priority: 1 });
      this.currentDj = dj;
    }

    // the news: rebuilt when a different game's events arrive
    const events = this.host.events();
    if (events !== this.announcerFor && banks.news) {
      const tags = indexCriteria(banks.news);
      this.announcer = new NewsAnnouncer(events, (t) => tags.has(t));
      this.announcerFor = events;
    }
    for (const tag of this.announcer?.due(year) ?? []) this.enqueue({ tag, category: "news", priority: 1 });

    if (this.playing || !this.timer) return;
    const clip = this.queue.next(this.ignoreLimits ? Infinity : now - this.lastEnd);
    if (clip) await this.play(clip, banks);
  }

  private async play(clip: SpeechClip, banks: Banks): Promise<void> {
    const g = this.host.graph();
    const bank = clip.category === "news" ? banks.news : clip.category === "tannoy" ? banks.tannoy.find((b) => indexCriteria(b).has(clip.tag)) ?? null : banks.dj;
    if (!bank || !g) { this.note = `dropped ${clip.tag}: ${!bank ? "its speech bank did not open" : "audio not unlocked yet"}`; return; }
    const ids = indexCriteria(bank).get(clip.tag);
    if (!ids?.length) { this.note = `dropped ${clip.tag}: the bank has no clip with that tag`; return; }
    this.note = `playing ${clip.tag}`;
    // a shuffle bag over the tag's samples, as the original's clip list (`ClipBag`)
    const sample = bank.byId.get(ids[this.clips.take(clip.tag, ids.length)]!);
    if (!sample) return;
    this.playing = true;
    let wav: Uint8Array | null = null;
    try {
      wav = await readLugClip(bank, sample);
      const buffer = await decodeClip(g.context, wav);
      const source = g.context.createBufferSource();
      source.buffer = buffer;
      const tannoy = clip.category === "tannoy";
      const fx = tannoy ? TANNOY_FILTER : RADIO_FILTER;
      const filter = g.context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = fx.frequency;
      filter.Q.value = fx.q;
      const gain = g.context.createGain();
      gain.gain.value = tannoy ? TANNOY_VOLUME : RADIO_FILTER.gain;
      source.connect(filter);
      if (tannoy) {
        // the dry voice plus one echo
        const dry = g.context.createGain();
        dry.gain.value = TANNOY_FILTER.dry;
        const echo = g.context.createDelay(1);
        echo.delayTime.value = TANNOY_FILTER.delayMs / 1000;
        const wet = g.context.createGain();
        wet.gain.value = TANNOY_FILTER.wet;
        filter.connect(dry).connect(gain);
        filter.connect(echo).connect(wet).connect(gain);
      } else {
        filter.connect(gain);
      }
      gain.connect(g.speechBus);
      this.host.duck(true);
      if (clip.category === "news") this.host.onNews?.(clip.tag);
      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
        source.start();
      });
    } catch (e) {
      this.note = `dropped ${clip.tag}: ${e instanceof Error ? e.message : "could not be read or decoded"}${wav ? ` [${describeWav(wav)}; sample ${sample.id}, record size ${sample.size}]` : ""}`;
      console.warn("speech clip dropped", clip.tag, this.note, e);
    } finally {
      this.host.duck(false);
      if (clip.category === "news") this.host.onNews?.(null);
      this.playing = false;
      if (this.note.startsWith("playing ")) this.note = `played ${this.note.slice(8)}`;
      this.lastEnd = performance.now();
    }
  }

  /** Called when the game's event list is read, so the announcer starts from the new game. */
  reset(): void {
    this.announcer = null;
    this.announcerFor = null;
    this.currentDj = null;
    this.runningMs = 0;
  }
}

export { parseTimelineEvents };
