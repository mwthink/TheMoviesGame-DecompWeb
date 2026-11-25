import { HttpSource } from "../assets/ByteSource.ts";
import { openLug, readLugClip, type LugBank, type LugSample } from "../formats/Lug.ts";
import { AMBIENCE_LAYERS, AmbienceEmitter, ambienceEra, ambienceGroup, ambienceLevels, type AmbienceLayer } from "../sim/audio/Ambience.ts";

/** What the ambience player needs from the audio manager. */
export interface AmbienceHost {
  /** The Web Audio context and the bus ambience goes to (the sound-effects bus). */
  graph(): { context: AudioContext; bus: GainNode } | null;
  locate(path: string): string | null;
  /** The game's current year. */
  year(): number;
  /** The camera's focus y in the lot's coordinates, which sets the lot and street levels. */
  focusY(): number;
}

interface Layer {
  emitter: AmbienceEmitter;
  samples: Map<number, LugSample>;
  gain: GainNode;
  timer: number;
}

/**
 * The lot, street and global ambience of a game (`sim/audio/Ambience.ts`). Clips come from the groups of `world.lug`. The original starts each layer as one engine
 * voice; the engine's own scheduling of the clips inside it was not read, so `AmbienceEmitter` plays them at the intervals the records suggest.
 */
export class AmbiencePlayer {
  private readonly host: AmbienceHost;
  private bank: Promise<LugBank | null> | null = null;
  private layers: Layer[] = [];
  private era = 0;
  private running = false;
  private levelTimer = 0;
  private sources = new Set<AudioBufferSourceNode>();

  constructor(host: AmbienceHost) {
    this.host = host;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.levelTimer = window.setInterval(() => this.tick(), 250);
    this.tick();
  }

  stop(): void {
    this.running = false;
    window.clearInterval(this.levelTimer);
    this.clearLayers();
  }

  private clearLayers(): void {
    for (const l of this.layers) {
      window.clearTimeout(l.timer);
      l.gain.disconnect();
    }
    this.layers = [];
    for (const s of this.sources) { try { s.stop(); } catch { /* already ended */ } }
    this.sources.clear();
    this.era = 0;
  }

  private openBank(): Promise<LugBank | null> {
    this.bank ??= (async () => {
      const url = this.host.locate("world.lug");
      if (!url) return null;
      try { return await openLug(await HttpSource.open("world.lug", url)); } catch { return null; }
    })();
    return this.bank;
  }

  private tick(): void {
    const g = this.host.graph();
    if (!g || !this.running) return;
    const era = ambienceEra(this.host.year());
    if (era !== this.era) { // `Audio_OnYearChanged`: stop the loops and start them for the new era
      this.clearLayers();
      this.era = era;
      void this.build(era, g);
    }
    const levels = ambienceLevels(this.host.focusY());
    for (const [i, layer] of AMBIENCE_LAYERS.entries()) {
      const l = this.layers[i];
      if (l) l.gain.gain.setTargetAtTime(levels[layer], g.context.currentTime, 0.15);
    }
  }

  private async build(era: number, g: { context: AudioContext; bus: GainNode }): Promise<void> {
    const bank = await this.openBank();
    if (!bank || !this.running || this.era !== era) return;
    const layers: Layer[] = [];
    for (const name of AMBIENCE_LAYERS) {
      const group = ambienceGroup(name, era).toLowerCase();
      const samples = bank.samples.filter((s) => s.group.toLowerCase() === group);
      const gain = g.context.createGain();
      gain.gain.value = 0;
      gain.connect(g.bus);
      const emitter = new AmbienceEmitter(samples.map((s) => ({ id: s.id, intervalSeconds: s.params.interval || 10, cooldownMs: s.params.extra })));
      layers.push({ emitter, samples: new Map(samples.map((s) => [s.id, s])), gain, timer: 0 });
    }
    this.layers = layers;
    for (const [i, layer] of AMBIENCE_LAYERS.entries()) this.schedule(i, layer, bank, g, 500 + Math.random() * 2000);
  }

  private schedule(index: number, layer: AmbienceLayer, bank: LugBank, g: { context: AudioContext; bus: GainNode }, delayMs: number): void {
    const l = this.layers[index];
    if (!l) return;
    l.timer = window.setTimeout(() => {
      const next = l.emitter.next(performance.now());
      if (!next) { this.schedule(index, layer, bank, g, 1000); return; }
      void this.play(l, next.clip.id, bank, g);
      this.schedule(index, layer, bank, g, next.waitMs);
    }, delayMs);
  }

  private async play(l: Layer, id: number, bank: LugBank, g: { context: AudioContext }): Promise<void> {
    const sample = l.samples.get(id);
    if (!sample) return;
    try {
      const wav = await readLugClip(bank, sample);
      const buffer = await g.context.decodeAudioData(wav.slice().buffer);
      if (!this.running || !this.layers.includes(l)) return;
      const source = g.context.createBufferSource();
      source.buffer = buffer;
      source.connect(l.gain);
      this.sources.add(source);
      source.onended = () => this.sources.delete(source);
      source.start();
    } catch { /* a clip that cannot be read or decoded is skipped */ }
  }
}
