// The expected numbers for the real banks come from reading the files with a throwaway Python script (segment sizes, sample counts, a clip's RIFF header).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ByteSource } from "../src/assets/ByteSource.ts";
import { indexCriteria, openLug, parseCriteria, readLugClip, readLugSegments } from "../src/formats/Lug.ts";
import { GAME_DIR } from "../localPaths.ts";
import { NodeSource, pakIndex } from "./helpers.ts";

const AUDIO_DIR = GAME_DIR ? join(GAME_DIR, "Data", "Audio") : "";
const game = { skip: AUDIO_DIR && existsSync(join(AUDIO_DIR, "starmaker.lug")) ? false : "game audio banks not found (set OTM_GAME_DIR)" };

class MemorySource implements ByteSource {
  readonly name = "memory.lug";
  readonly size: number;
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.size = bytes.byteLength;
  }
  async read(offset: number, length: number): Promise<Uint8Array> {
    return this.bytes.subarray(offset, Math.min(this.size, offset + length));
  }
}

function segment(name: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(36 + payload.byteLength);
  out.set(new TextEncoder().encode(name));
  new DataView(out.buffer).setUint32(32, payload.byteLength, true);
  out.set(payload, 36);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

function record(name: string, id: number, waveId: number, size: number, offset: number): Uint8Array {
  const rec = new Uint8Array(0x28c);
  const v = new DataView(rec.buffer);
  rec.set(new TextEncoder().encode(name));
  v.setUint32(0x104, id, true);
  v.setUint32(0x108, waveId, true);
  v.setUint32(0x10c, size, true);
  v.setUint32(0x110, offset, true);
  v.setUint16(0x124, 1, true);
  v.setUint16(0x126, 1, true);
  v.setUint32(0x128, 22050, true);
  v.setUint32(0x12c, 44100, true);
  v.setUint16(0x130, 2, true);
  v.setUint16(0x132, 16, true);
  v.setInt32(0x138, -1, true);
  v.setInt32(0x13c, -1, true);
  rec.set(new TextEncoder().encode("Street_1950"), 0x140);
  v.setUint32(0x244, 0x180, true);
  v.setFloat32(0x268, 3, true);
  v.setFloat32(0x26c, 25, true);
  v.setUint32(0x27c, 0xffffffff, true);
  return rec;
}

function u32s(...n: number[]): Uint8Array {
  const out = new Uint8Array(n.length * 4);
  n.forEach((x, i) => new DataView(out.buffer).setUint32(i * 4, x, true));
  return out;
}

function syntheticBank(): Uint8Array {
  const wave = new Uint8Array(12).map((_, i) => i + 1);
  const table = concat([u32s(4), record("a.wav", 1, 1, 8, 0), record("alias.wav", 2, 1, 8, 8), record("skipped.wav", 0, 0, 4, 8), record("dup.wav", 1, 1, 4, 8)]);
  const tag = new TextEncoder().encode("SM_CLICK");
  const criteria = concat([u32s(1, tag.byteLength), tag, u32s(2, 1, 2)]);
  return concat([new TextEncoder().encode("LiOnHeAd"), segment("LHAudioWaveData", wave), segment("LHAudioBankSampleTable", table), segment("LHAudioBankCriteiaInfo", criteria)]);
}

test("a bank's directory, records, aliases, skipped ids and collisions", async () => {
  const bank = await openLug(new MemorySource(syntheticBank()));
  assert.deepEqual([...bank.segments.keys()], ["LHAudioWaveData", "LHAudioBankSampleTable", "LHAudioBankCriteiaInfo"]);
  assert.deepEqual(bank.samples.map((s) => s.id), [1, 2]); // id 0 skipped, the second id 1 dropped
  assert.deepEqual(bank.collisions, [1]);
  const a = bank.byId.get(1)!;
  assert.equal(a.name, "a.wav");
  assert.equal(a.group, "Street_1950");
  assert.deepEqual(a.format, { tag: 1, channels: 1, sampleRate: 22050, bytesPerSecond: 44100, blockAlign: 2, bitsPerSample: 16 });
  assert.equal(a.loopStart, -1);
  assert.deepEqual(a.params, { priority: 1, flags: 0x180, minDistance: 3, maxDistance: 25, extra: 1 });
  assert.deepEqual([...(await readLugClip(bank, a))], [1, 2, 3, 4, 5, 6, 7, 8]);
  // the alias reads its target's audio, not its own offset
  assert.deepEqual([...(await readLugClip(bank, bank.byId.get(2)!))], [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(bank.criteria, [{ tag: "SM_CLICK", sampleIds: [1, 2] }]);
  assert.deepEqual([...indexCriteria(bank)], [["SM_CLICK", [1, 2]]]);
});

test("a file without the magic, or a segment that runs past the end, is refused", async () => {
  await assert.rejects(readLugSegments(new MemorySource(new Uint8Array(64))), /not a .lug file/);
  const bad = syntheticBank().subarray(0, 50);
  await assert.rejects(readLugSegments(new MemorySource(bad)), /runs past the end/);
});

test("criteria that run past their segment are refused", () => {
  assert.throws(() => parseCriteria(u32s(1, 100)), RangeError);
});

test("starmaker.lug: 11 UI clips, criteria SM_CLICK first, clips are RIFF/WAVE", game, async () => {
  const bank = await openLug(await NodeSource.open(join(AUDIO_DIR, "starmaker.lug")));
  assert.equal(bank.samples.length, 11);
  assert.deepEqual(bank.collisions, []);
  assert.equal(bank.criteria.length, 5);
  assert.deepEqual(bank.criteria[0], { tag: "SM_CLICK", sampleIds: [1] });
  const first = bank.samples[0];
  assert.equal(first.size, 5948);
  assert.equal(first.format.sampleRate, 44100);
  const clip = await readLugClip(bank, first);
  assert.equal(new TextDecoder().decode(clip.subarray(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(clip.subarray(8, 12)), "WAVE");
  assert.equal(new DataView(clip.buffer, clip.byteOffset).getUint32(4, true) + 8, first.size);
});

test("every shipped bank opens, and each clip's RIFF size matches its record", game, async () => {
  const counts: Record<string, number> = { "soundbank_01.lug": 2430, "MM_soundbank_02.lug": 221, "add_on_soundbank_john.lug": 99, "awards_ambience.lug": 37, "starmaker.lug": 11, "world.lug": 277 };
  for (const [file, count] of Object.entries(counts)) {
    const bank = await openLug(await NodeSource.open(join(AUDIO_DIR, file)));
    assert.equal(bank.samples.length + bank.collisions.length, count, file);
    // spot-check the first, middle and last clips
    for (const i of [0, bank.samples.length >> 1, bank.samples.length - 1]) {
      const s = bank.samples[i];
      const head = await readLugClip(bank, { ...s, size: 12 });
      assert.equal(new TextDecoder().decode(head.subarray(0, 4)), "RIFF", `${file} #${i}`);
      assert.equal(new DataView(head.buffer, head.byteOffset).getUint32(4, true) + 8, bank.byId.get(s.waveId)?.size ?? s.size, `${file} #${i}`);
    }
  }
});

test("the speech banks carry what the radio asks for: every DJ and news tag, with clips that are RIFF/WAVE", game, async () => {
  const { djForYear, parseDjSchedule, parseTimelineEvents } = await import("../src/sim/audio/RadioSpeech.ts");
  const { readFileSync } = await import("node:fs");
  const dj = await openLug(await NodeSource.open(join(AUDIO_DIR, "EN-UK", "speech_dj.lug")));
  const news = await openLug(await NodeSource.open(join(AUDIO_DIR, "EN-UK", "speech_news.lug")));
  const djTags = indexCriteria(dj);
  const schedule = parseDjSchedule(readFileSync(join(AUDIO_DIR, "radiostinginfo.csv"), "latin1"));
  for (const e of schedule) assert.ok(djTags.get(e.tag)?.length, e.tag);
  assert.ok((djTags.get(djForYear(schedule, 1960).talk!) ?? []).length > 100);
  const clip = await readLugClip(dj, dj.byId.get(djTags.get("RADIO_DJ_MADDOG")![0])!);
  assert.equal(new TextDecoder().decode(clip.subarray(0, 4)), "RIFF");
  const newsTags = indexCriteria(news);
  const events = parseTimelineEvents(new TextDecoder("latin1").decode((await (await pakIndex()).readByName("timeline.csv"))!));
  assert.equal(events.length, 30);
  // report how many of the timeline's events have a clip: the rest are simply never announced
  const have = events.filter((e) => newsTags.has(e.tag)).length;
  assert.ok(have >= 25, `only ${have} of ${events.length} events have news`);
});
