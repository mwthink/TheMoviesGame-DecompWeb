// Node only (the dev server and the tests): where this machine keeps the game install and its saved games.
//
// Read from environment variables, or from `local.env` at the repository root (gitignored; `local.env.example` lists the keys).
// An environment variable wins over the file. Nothing here has a machine-specific default: only the game's own standard folders.
//
//   OTM_GAME_DIR   the game install, the folder with MoviesSE.exe and Data/pak
//   OTM_PAK_DIR    the archives, if not <OTM_GAME_DIR>/Data/pak
//   OTM_SAVE_DIR   saved games (default: ~/Documents/The Movies/Saved Games, where the game writes them)
//   OTM_STAR_DIR   StarMaker stars (default: ~/Documents/The Movies/StarMaker)
//   OTM_SAVE       the save the dev server's ?autoload opens (default: the first one in OTM_SAVE_DIR)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readLocalEnv(): Record<string, string> {
  const file = join(repoRoot, "local.env");
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^~(?=\/|$)/, homedir());
  }
  return out;
}

const fileEnv = readLocalEnv();
const get = (key: string): string | undefined => process.env[key] ?? fileEnv[key];

/** The game install (OTM_GAME_DIR), or undefined. */
export const GAME_DIR: string | undefined = get("OTM_GAME_DIR");
const gameDir = GAME_DIR;
export const PAK_DIR: string | undefined = get("OTM_PAK_DIR") ?? (gameDir ? join(gameDir, "Data", "pak") : undefined);
export const SAVE_DIR: string = get("OTM_SAVE_DIR") ?? join(homedir(), "Documents", "The Movies", "Saved Games");
export const STAR_DIR: string = get("OTM_STAR_DIR") ?? join(homedir(), "Documents", "The Movies", "StarMaker");

/** The saved games in SAVE_DIR, sorted by name. */
export function listSaves(): string[] {
  return existsSync(SAVE_DIR) ? readdirSync(SAVE_DIR).filter((n) => n.toLowerCase().endsWith(".jad")).sort() : [];
}

/** The save for the dev server's ?autoload: OTM_SAVE, else the first in SAVE_DIR. */
export function defaultSave(): string | undefined {
  const explicit = get("OTM_SAVE");
  if (explicit) return explicit;
  const first = listSaves()[0];
  return first ? join(SAVE_DIR, first) : undefined;
}

/**
 * Saves of a given kind, found by what they are rather than by file name. The game names a save "<studio name><in-game date><time><weekday><real date>.jad";
 * the in-game date is the game's own part of the name, so it narrows the search; the tests then check the contents (tests/helpers.ts).
 * OTM_SAVE_<ROLE> names one file and skips the search.
 */
export const SAVE_ROLES = {
  /** A new studio straight after the tutorial: a blank lot (the lot, its billboard and the gatehouse) on 1 January 1920. */
  FRESH: "1 January 1920",
  /** A Quick Start studio just after it has loaded: 22 January 1960. */
  QUICKSTART: "22 January 1960",
} as const;

export type SaveRole = keyof typeof SAVE_ROLES;

export function saveCandidates(role: SaveRole): string[] {
  const explicit = get(`OTM_SAVE_${role}`);
  if (explicit) return existsSync(explicit) ? [explicit] : [];
  return listSaves().filter((n) => n.includes(SAVE_ROLES[role])).map((n) => join(SAVE_DIR, n));
}
