import { existsSync } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ByteSource } from "../src/assets/ByteSource.ts";
import { PakIndex } from "../src/assets/Pak.ts";

/** Where the tests look for the game's archives and a saved game. Override with OTM_PAK_DIR / OTM_SAVE (the same data the Python tools use). */
export const PAK_DIR =
  process.env.OTM_PAK_DIR ?? join(homedir(), "Library/Application Support/CrossOver/Bottles/tmovies/drive_c/Games/TheMovies/Data/pak");
export const SAVE_PATH =
  process.env.OTM_SAVE ?? join(homedir(), "Documents/The Movies/Saved Games/wine studios1 January 19202357Monday23November2026.jad");

export const haveGame = existsSync(PAK_DIR);
export const haveSave = existsSync(SAVE_PATH);

/** A file on disk as a ByteSource (reads ranges, like the browser's File does). */
export class NodeSource implements ByteSource {
  readonly name: string;
  readonly size: number;
  private readonly path: string;

  private constructor(name: string, path: string, size: number) {
    this.name = name;
    this.path = path;
    this.size = size;
  }

  static async open(path: string): Promise<NodeSource> {
    return new NodeSource(path.split("/").pop()!, path, (await stat(path)).size);
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const fh = await open(this.path, "r");
    try {
      const n = Math.min(length, this.size - offset);
      const buf = new Uint8Array(n);
      const { bytesRead } = await fh.read(buf, 0, n, offset);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  }
}

let cached: Promise<PakIndex> | undefined;
export function pakIndex(): Promise<PakIndex> {
  cached ??= (async () => {
    const names = (await readdir(PAK_DIR)).filter((n) => n.toLowerCase().endsWith(".pak"));
    return PakIndex.open(await Promise.all(names.map((n) => NodeSource.open(join(PAK_DIR, n)))));
  })();
  return cached;
}
