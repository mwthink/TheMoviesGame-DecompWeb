// Helpers for the tuning loaders: read a float setting into a tuning object, reporting what is missing, and read a data file's text from the
// player's archives. A missing or unreadable value keeps its default; loaders never fail.
import type { PakIndex } from "../../assets/Pak.ts";
import type { Ini } from "../../formats/Ini.ts";

/** What a loader could not read: "file [section] key: missing" / "not a number", and unreadable files. */
export interface LoadReport {
  problems: string[];
}

export const newReport = (): LoadReport => ({ problems: [] });

/** Reads `section/key` of an ini as a float into `target[field]`; otherwise keeps the value and records the problem. */
export function readFloat<T extends object>(ini: Ini, file: string, section: string, key: string, target: T, field: keyof T, report: LoadReport): void {
  const v = ini.getNumber(section, key);
  if (v === undefined) {
    report.problems.push(`${file} [${section}] ${key}: ${ini.has(section, key) ? "not a number" : "missing"}`);
    return;
  }
  (target as Record<keyof T, number>)[field] = Math.fround(v);
}

/** The text of a data file in the archives (the newest archive wins), or undefined. */
export async function readDataText(pak: PakIndex, name: string): Promise<string | undefined> {
  const bytes = await pak.readByName(name);
  return bytes ? new TextDecoder("latin1").decode(bytes) : undefined;
}
