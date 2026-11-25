import { HttpSource } from "../assets/ByteSource.ts";
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
}

/** The radio's voice filter, from `Data/Audio/radioeffect.ini` `[radio]`: a band-pass at 1548 Hz, Q 5, with make-up gain 1.6. */
const RADIO_FILTER = { frequency: 1548, q: 5, gain: 1.6 };

interface Banks {
  dj: LugBank | null;
  news: LugBank | null;
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

  constructor(host: SpeechHost) {
    this.host = host;
  }

  /** The radio is on: watch the date and let clips through. */
  start(): void {
    if (this.timer) return;
    this.lastTick = performance.now();
    this.timer = window.setInterval(() => void this.tick(), 1000);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  /** The DJ may talk over the current track (the roll and the position were checked by the radio). */
  djChatter(): void {
    void this.banks_().then((b) => {
      const dj = djForYear(b.schedule, Math.floor(this.host.date() / 365));
      if (dj.talk) this.enqueue({ tag: dj.talk, category: "dj", priority: 1 });
    });
  }

  private enqueue(clip: SpeechClip): void {
    this.queue.queue(clip, this.runningMs / 100); // ticks at the original's 10 Hz
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
      const [dj, news] = await Promise.all([open("speech_dj.lug"), open("speech_news.lug")]);
      return { dj, news, schedule };
    })();
    return this.banks;
  }

  private async tick(): Promise<void> {
    const now = performance.now();
    this.runningMs += now - this.lastTick;
    this.lastTick = now;
    const banks = await this.banks_();
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

    if (this.playing) return;
    const clip = this.queue.next(now - this.lastEnd);
    if (clip) await this.play(clip, banks);
  }

  private async play(clip: SpeechClip, banks: Banks): Promise<void> {
    const bank = clip.category === "news" ? banks.news : banks.dj;
    const g = this.host.graph();
    if (!bank || !g) return;
    const ids = indexCriteria(bank).get(clip.tag);
    if (!ids?.length) return;
    // a shuffle bag over the tag's samples, as the original's clip list (`ClipBag`)
    const sample = bank.byId.get(ids[this.clips.take(clip.tag, ids.length)]!);
    if (!sample) return;
    this.playing = true;
    try {
      const wav = await readLugClip(bank, sample);
      const buffer = await g.context.decodeAudioData(wav.slice().buffer);
      const source = g.context.createBufferSource();
      source.buffer = buffer;
      const filter = g.context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = RADIO_FILTER.frequency;
      filter.Q.value = RADIO_FILTER.q;
      const gain = g.context.createGain();
      gain.gain.value = RADIO_FILTER.gain;
      source.connect(filter).connect(gain).connect(g.speechBus);
      this.host.duck(true);
      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
        source.start();
      });
    } catch { /* a clip that cannot be read or decoded is skipped */ } finally {
      this.host.duck(false);
      this.playing = false;
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
