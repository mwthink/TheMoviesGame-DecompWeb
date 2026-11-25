import { existsSync, readFileSync } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ByteSource } from "../src/assets/ByteSource.ts";
import { PakIndex } from "../src/assets/Pak.ts";
import { parseSave, type Save } from "../src/formats/Jad.ts";
import { PAK_DIR as PAK, saveCandidates, type SaveRole } from "../localPaths.ts";

/** The game's archives (OTM_GAME_DIR or OTM_PAK_DIR, see localPaths.ts). Tests that need them skip when they are absent. */
export const PAK_DIR = PAK ?? "";
export const haveGame = PAK !== undefined && existsSync(PAK);

/** What makes a save the kind a test expects (the date in its name only narrows the search). */
const ROLE_CHECKS: Record<SaveRole, (s: Save) => boolean> = {
  FRESH: (s) => s.placed.length === 3,
  QUICKSTART: (s) => s.placed.length > 200,
};

/** The first save of that kind on this machine, or undefined (the test skips). */
export function findSave(role: SaveRole): string | undefined {
  for (const path of saveCandidates(role)) {
    try {
      if (ROLE_CHECKS[role](parseSave(new Uint8Array(readFileSync(path))))) return path;
    } catch {
      // not a save this reader understands: keep looking
    }
  }
  return undefined;
}

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
