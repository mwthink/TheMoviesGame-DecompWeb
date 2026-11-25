import type { ByteSource } from "../assets/ByteSource.ts";

/**
 * Reader for the game's `.lug` sound banks (docs/AUDIO.md). A bank is a Lionhead segment container ("LiOnHeAd", then segments of a 32-byte name, a u32 size
 * and the payload) holding a sample table, the clips as RIFF/WAVE files packed back to back, and the event criteria that select clips.
 *
 * Banks are big (`soundbank_01.lug` is 290 MB), so only the directory, the sample table and the criteria are read when a bank is opened; a clip is read
 * by range when it is wanted.
 */

const MAGIC = "LiOnHeAd";
const SEGMENT_HEADER = 36;
const SAMPLE_RECORD = 0x28c;

export const SEG_WAVE_DATA = "LHAudioWaveData";
export const SEG_SAMPLE_TABLE = "LHAudioBankSampleTable";
/** Spelt like this in the shipped files: the "r" of "Criteria" is missing (orig: 0x00C00080), so it has to be matched as is. */
export const SEG_CRITERIA = "LHAudioBankCriteiaInfo";
export const SEG_GLOBAL_PROPS = "LHAudioBankGlobalProps";
export const SEG_BANK_INFO = "LHFileSegmentBankInfo";
export const SEG_META_DATA = "LHAudioBankMetaData";

/** The wave format a record carries: the fields of a `WAVEFORMATEX`, minus the extra bytes. Tag 1 is PCM. */
export interface LugWaveFormat {
  tag: number;
  channels: number;
  sampleRate: number;
  bytesPerSecond: number;
  blockAlign: number;
  bitsPerSample: number;
}

/** What `LH_BuildDriverTable` (orig: 0x00C00660) reads from a record's parameter block. What each field does while playing is inferred, not measured. */
export interface LugSampleParams {
  /** Record `+0x240`; 1 when 0. A priority or weight (Fable's files hold 1, 300, 1000). */
  priority: number;
  /** Record `+0x244`: which optional fields are present (0x80 and 0x100 are the two distances below). */
  flags: number;
  /** Record `+0x268`, only with flag 0x80: the distance inside which the sound is at full volume (3 to 5 in Fable's files). */
  minDistance?: number;
  /** Record `+0x26c`, only with flag 0x100: the distance beyond which it is silent (25 to 35 in Fable's files). */
  maxDistance?: number;
  /** Record `+0x27c`; 1 when -1. */
  extra: number;
}

export interface LugSample {
  /** Position in the bank's sample table. */
  index: number;
  /** The path the clip was authored from (a Windows path on the developer's machine); the file name is the clip's name. */
  name: string;
  /** Record `+0x104`; what the criteria refer to. */
  id: number;
  /** Record `+0x108`: equal to `id` for a clip, another sample's id for an alias that shares that clip's audio. */
  waveId: number;
  /** Size of the RIFF/WAVE file in bytes. */
  size: number;
  /** Where the clip starts in the bank file (the wave-data segment's start plus the record's offset). */
  offset: number;
  format: LugWaveFormat;
  /** Loop points in samples; -1 for no loop. */
  loopStart: number;
  loopEnd: number;
  /** Record `+0x140`: a group or category name, e.g. the era an ambience belongs to (`Street_1950` in `world.lug`); "" when none. */
  group: string;
  params: LugSampleParams;
}

/** One entry of the criteria segment: an event tag (`SM_CLICK`, `BUILDING_SITE_0`; Fable uses `SI_HERO;SE_FOOTSTEP;MATERIAL_GRASS`) and the samples it can play. */
export interface LugCriterion {
  tag: string;
  sampleIds: number[];
}

export interface LugBank {
  source: ByteSource;
  /** Each segment's payload start and size, by name. */
  segments: Map<string, { offset: number; size: number }>;
  /** Records with an id; ones with id 0 are skipped, as the original does. */
  samples: LugSample[];
  /** Sample by id. A repeated id keeps the first record and is listed in `collisions` (the original logs "Resource collision" and drops it). */
  byId: Map<number, LugSample>;
  collisions: number[];
  criteria: LugCriterion[];
}

const text = new TextDecoder("latin1");

function cString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return text.decode(end < 0 ? bytes : bytes.subarray(0, end));
}

/**
 * The segment directory (`LH_DecodeSegmentStructure`, orig: 0x00C0A430): walks the segments from byte 8 to the end of the file.
 * Throws if the magic is missing or a segment runs past the end.
 */
export async function readLugSegments(source: ByteSource): Promise<Map<string, { offset: number; size: number }>> {
  const head = await source.read(0, 8);
  if (text.decode(head) !== MAGIC) throw new Error(`${source.name}: not a .lug file`);
  const segments = new Map<string, { offset: number; size: number }>();
  let pos = 8;
  while (pos + SEGMENT_HEADER <= source.size) {
    const h = await source.read(pos, SEGMENT_HEADER);
    const size = new DataView(h.buffer, h.byteOffset, h.byteLength).getUint32(32, true);
    const name = cString(h.subarray(0, 32));
    if (pos + SEGMENT_HEADER + size > source.size) throw new Error(`${source.name}: segment ${name} runs past the end of the file`);
    // quirk: a repeated segment name would replace the first in the original's map too; shipped banks have none.
    segments.set(name, { offset: pos + SEGMENT_HEADER, size });
    pos += SEGMENT_HEADER + size;
  }
  return segments;
}

/** One 0x28c-byte record of the sample table (`LH_LoadSampleBankTable`, orig: 0x00BFFE70). `waveBase` is the wave-data segment's start. */
export function parseSampleRecord(rec: Uint8Array, index: number, waveBase: number): LugSample {
  const v = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
  const flags = v.getUint32(0x244, true);
  const priority = v.getUint32(0x240, true);
  const extra = v.getUint32(0x27c, true);
  const params: LugSampleParams = { priority: priority === 0 ? 1 : priority, flags, extra: extra === 0xffffffff ? 1 : extra };
  if (flags & 0x80) params.minDistance = v.getFloat32(0x268, true);
  if (flags & 0x100) params.maxDistance = v.getFloat32(0x26c, true);
  return {
    index,
    name: cString(rec.subarray(0, 0x104)),
    id: v.getUint32(0x104, true),
    waveId: v.getUint32(0x108, true),
    size: v.getUint32(0x10c, true),
    offset: waveBase + v.getUint32(0x110, true),
    format: {
      tag: v.getUint16(0x124, true),
      channels: v.getUint16(0x126, true),
      sampleRate: v.getUint32(0x128, true),
      bytesPerSecond: v.getUint32(0x12c, true),
      blockAlign: v.getUint16(0x130, true),
      bitsPerSample: v.getUint16(0x132, true),
    },
    loopStart: v.getInt32(0x138, true),
    loopEnd: v.getInt32(0x13c, true),
    group: cString(rec.subarray(0x140, 0x240)),
    params,
  };
}

/** The criteria segment (`LH_LoadBankCriteriaInfo`, orig: 0x00C00080): u32 count, then per entry a length-prefixed tag and a counted list of sample ids. */
export function parseCriteria(bytes: Uint8Array): LugCriterion[] {
  if (bytes.byteLength < 4) return [];
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = v.getUint32(0, true);
  const out: LugCriterion[] = [];
  let p = 4;
  for (let i = 0; i < count; i++) {
    const len = v.getUint32(p, true);
    p += 4;
    const tag = text.decode(bytes.subarray(p, p + len));
    p += len;
    const n = v.getUint32(p, true);
    p += 4;
    const sampleIds: number[] = [];
    for (let k = 0; k < n; k++, p += 4) sampleIds.push(v.getUint32(p, true));
    out.push({ tag, sampleIds });
  }
  if (p > bytes.byteLength) throw new Error("criteria segment is shorter than its entries");
  return out;
}

/**
 * Opens a bank: the segment directory, the sample table and the criteria. Mirrors the load order in docs/AUDIO.md (`LH_LoadLUGAsset`, orig: 0x00C009C0), minus
 * the parts that only feed the driver: global properties, the bank-info version check and the RLM parameters are not read.
 * The newer "META Data" form (`LHAudioBankMetaData`) is present in most shipped banks next to the classic segments and is ignored.
 */
export async function openLug(source: ByteSource): Promise<LugBank> {
  const segments = await readLugSegments(source);
  const wave = segments.get(SEG_WAVE_DATA);
  const table = segments.get(SEG_SAMPLE_TABLE);
  if (!wave || !table) throw new Error(`${source.name}: no wave-data or sample-table segment`);

  const tableBytes = await source.read(table.offset, table.size);
  // The count is masked to 16 bits: Fable's files (and world.lug) keep a second u16 beside it that nothing reads.
  const count = new DataView(tableBytes.buffer, tableBytes.byteOffset, tableBytes.byteLength).getUint16(0, true);
  if (4 + count * SAMPLE_RECORD > tableBytes.byteLength) throw new Error(`${source.name}: sample table is shorter than its count`);

  const samples: LugSample[] = [];
  const byId = new Map<number, LugSample>();
  const collisions: number[] = [];
  for (let i = 0; i < count; i++) {
    const rec = tableBytes.subarray(4 + i * SAMPLE_RECORD, 4 + (i + 1) * SAMPLE_RECORD);
    const s = parseSampleRecord(rec, i, wave.offset);
    if (s.id === 0) continue; // LH_ExtractResources (orig: 0x00C00480) skips them
    if (byId.has(s.id)) {
      collisions.push(s.id);
      continue;
    }
    samples.push(s);
    byId.set(s.id, s);
  }

  const crit = segments.get(SEG_CRITERIA);
  const criteria = crit ? parseCriteria(await source.read(crit.offset, crit.size)) : [];
  return { source, segments, samples, byId, collisions, criteria };
}

/**
 * The clip's bytes: a complete RIFF/WAVE file the browser can decode. An alias (`waveId` is another sample's id) plays that sample's audio, as the original
 * does by not extracting it again.
 */
export async function readLugClip(bank: LugBank, sample: LugSample): Promise<Uint8Array> {
  const target = sample.waveId !== sample.id ? bank.byId.get(sample.waveId) ?? sample : sample;
  return bank.source.read(target.offset, target.size);
}

/** The criteria (event tags) that can play a sample, for building a tag index. */
export function indexCriteria(bank: LugBank): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const c of bank.criteria) out.set(c.tag, [...(out.get(c.tag) ?? []), ...c.sampleIds]);
  return out;
}
