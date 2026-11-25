import type { ByteSource } from "./ByteSource.ts";
import { gameHash } from "./hash.ts";
import { inflate } from "./inflate.ts";

/** One file inside a .pak archive (layout in tools/pak_extract.py). */
export interface PakEntry {
  name: string;
  hash: number;
  offset: number;
  compressed: number;
  size: number;
  flags: number;
}

export interface PakFile {
  archive: PakArchive;
  entry: PakEntry;
  /** Directory inside the archive, such as `data\textures\`. */
  dir: string;
}

const HEADER = 0x34;

export class PakArchive {
  readonly source: ByteSource;
  readonly entries: PakEntry[];
  readonly dirs: string[];

  private constructor(source: ByteSource, entries: PakEntry[], dirs: string[]) {
    this.source = source;
    this.entries = entries;
    this.dirs = dirs;
  }

  /** Read the header and entry table (a few hundred KB at most). Returns null for formats we do not read (version 4 costume paks). */
  static async open(source: ByteSource): Promise<PakArchive | null> {
    const head = await source.read(0, HEADER);
    if (head.length < HEADER) return null;
    const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const version = hv.getUint32(0, true);
    if (version !== 5 && version !== 6) return null;
    const count = hv.getUint32(0x0c, true);
    const ndir = hv.getUint32(0x14, true);
    const table = hv.getUint32(0x28, true);
    const dirNames = hv.getUint32(0x30, true);

    const raw = await source.read(table, 56 * count);
    const rv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const entries: PakEntry[] = [];
    for (let i = 0; i < count; i++) {
      const o = i * 56;
      entries.push({
        hash: rv.getUint32(o, true),
        offset: rv.getUint32(o + 8, true),
        compressed: rv.getUint32(o + 12, true),
        size: rv.getUint32(o + 16, true),
        flags: rv.getUint32(o + 20, true),
        name: latin1(raw.subarray(o + 24, o + 56)),
      });
    }
    const dirBytes = await source.read(dirNames, 4096);
    const dirs = latin1Split(dirBytes).slice(0, ndir);
    return new PakArchive(source, entries, dirs);
  }

  /** The directory an entry lives in: the one whose name, joined with the file name, hashes to the entry's first u32. */
  resolveDir(entry: PakEntry): string {
    for (const d of this.dirs) {
      if (gameHash(d + entry.name) === entry.hash) return d;
    }
    return "";
  }

  /** Read and decompress one file. */
  async read(entry: PakEntry): Promise<Uint8Array> {
    const chunk = await this.source.read(entry.offset, 16 + entry.compressed);
    const v = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const uncompressed = v.getUint32(4, true);
    const stored = v.getUint32(12, true);
    const data = stored === 1 ? chunk.subarray(16, 16 + uncompressed) : inflate(chunk.subarray(16), uncompressed);
    if (data.length !== uncompressed) {
      throw new Error(`${entry.name}: size mismatch (${data.length}, expected ${uncompressed})`);
    }
    return data;
  }
}

/** All the game's archives together. Later archives override earlier ones for the same directory and name; the Addon_* patch archives come last. */
export class PakIndex {
  private readonly archives: PakArchive[];
  private readonly byName = new Map<string, { archive: PakArchive; entry: PakEntry }[]>();

  private constructor(archives: PakArchive[]) {
    this.archives = archives;
    for (const archive of archives) {
      for (const entry of archive.entries) {
        const key = entry.name.toLowerCase();
        const list = this.byName.get(key);
        if (list) list.push({ archive, entry });
        else this.byName.set(key, [{ archive, entry }]);
      }
    }
  }

  static async open(sources: ByteSource[]): Promise<PakIndex> {
    const rank = (s: ByteSource) => (s.name.toLowerCase().startsWith("addon") ? 1 : 0);
    const sorted = [...sources].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const archives: PakArchive[] = [];
    for (const s of sorted) {
      const a = await PakArchive.open(s);
      if (a) archives.push(a);
    }
    return new PakIndex(archives);
  }

  get archiveCount(): number {
    return this.archives.length;
  }

  /**
   * Find a file by name (case-insensitive). The newest archive wins. Several files can share a name in different directories
   * (`hair_50s_m1.dds` is a texture and also a thumbnail), so `dir` picks one exactly (`data\textures\`) and `dirHint` prefers
   * a directory containing the text.
   */
  find(name: string, opts: { dir?: string; dirHint?: string } = {}): PakFile | undefined {
    const list = this.byName.get(name.toLowerCase());
    if (!list) return undefined;
    let fallback: PakFile | undefined;
    for (let i = list.length - 1; i >= 0; i--) {
      const { archive, entry } = list[i]!;
      const dir = archive.resolveDir(entry);
      const lower = dir.toLowerCase();
      if (opts.dir !== undefined && lower !== opts.dir.toLowerCase()) continue;
      const found = { archive, entry, dir };
      if (opts.dirHint === undefined || lower.includes(opts.dirHint.toLowerCase())) return found;
      fallback ??= found;
    }
    return fallback;
  }

  async read(file: PakFile): Promise<Uint8Array> {
    return file.archive.read(file.entry);
  }

  async readByName(name: string, opts: { dir?: string; dirHint?: string } = {}): Promise<Uint8Array | undefined> {
    const f = this.find(name, opts);
    return f ? this.read(f) : undefined;
  }
}

function latin1(bytes: Uint8Array): string {
  let end = bytes.indexOf(0);
  if (end < 0) end = bytes.length;
  let s = "";
  for (let i = 0; i < end; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

function latin1Split(bytes: Uint8Array): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i <= bytes.length; i++) {
    if (i === bytes.length || bytes[i] === 0) {
      let s = "";
      for (let j = start; j < i; j++) s += String.fromCharCode(bytes[j]!);
      out.push(s);
      start = i + 1;
    }
  }
  return out;
}
