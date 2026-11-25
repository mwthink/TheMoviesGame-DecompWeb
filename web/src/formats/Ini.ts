/**
 * The game's .ini dialect (Data\releasing_movies.ini, stunts.ini, global.ini, facility inis, camera.ini, ...):
 * `[section]` headers, `key = value`, `#` full-line comments, CRLF or LF, a trailing `;` on a value is dropped (global.ini has
 * `DebutAwardRotateInterval = 6000;`). Section and key names are case-insensitive. Keys before the first `[section]` belong to the section ""
 * (experience.ini, awardsbonuses.ini, the top of stunts.ini). Lines without `=` are kept as the section's bare lines (ranking.ini lists achievement
 * names that way). A section that appears twice is merged; when a key repeats, the last one wins.
 *
 * `get("section/key")` (or `get("key")` for the "" section) is the short form; sections such as `[a/b]` are matched as written.
 */
export class Ini {
  private readonly sections = new Map<string, { entries: Map<string, string>; bare: string[] }>();

  static parse(text: string): Ini {
    const ini = new Ini();
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // byte order mark
    let current = "";
    let started = false; // the "" section exists only if a key comes before the first [section]
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim(); // also removes the \r of CRLF files
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("[")) {
        const close = line.indexOf("]");
        if (close < 0) continue;
        current = line.slice(1, close).trim().toLowerCase();
        started = true;
        ini.section(current);
        continue;
      }
      if (!started) started = true;
      const s = ini.section(current);
      const eq = line.indexOf("=");
      if (eq < 0) {
        s.bare.push(line);
        continue;
      }
      let value = line.slice(eq + 1).trim();
      if (value.endsWith(";")) value = value.slice(0, -1).trim();
      s.entries.set(line.slice(0, eq).trim().toLowerCase(), value); // the last duplicate wins; Map keeps the first position
    }
    return ini;
  }

  private section(lowerName: string) {
    let s = this.sections.get(lowerName);
    if (!s) this.sections.set(lowerName, (s = { entries: new Map(), bare: [] }));
    return s;
  }

  /** `section/key`, or a bare `key` for keys before the first section. A section name may itself contain `/`: the last `/` splits. */
  get(path: string): string | undefined {
    const p = path.toLowerCase();
    const cut = p.lastIndexOf("/");
    return cut < 0 ? this.getString("", p) : this.getString(p.slice(0, cut), p.slice(cut + 1));
  }

  hasSection(section: string): boolean {
    return this.sections.has(section.toLowerCase());
  }

  has(section: string, key: string): boolean {
    return this.getString(section, key) !== undefined;
  }

  getString(section: string, key: string): string | undefined {
    return this.sections.get(section.toLowerCase())?.entries.get(key.toLowerCase());
  }

  /** The value as a number, or undefined when missing or not entirely a number ("1.5", "-0.4", "1e-5" are numbers; "", "abc", "1.5x" are not). */
  getNumber(section: string, key: string): number | undefined {
    return parseNumber(this.getString(section, key));
  }

  /** Section names in order of first appearance, lower-cased ("" first when keys come before any section). */
  sectionNames(): string[] {
    return [...this.sections.keys()];
  }

  /** Key / value pairs of a section in file order (keys lower-cased). */
  entries(section: string): [string, string][] {
    return [...(this.sections.get(section.toLowerCase())?.entries ?? [])];
  }

  /** Lines without `=` in file order. */
  bareLines(section: string): string[] {
    return [...(this.sections.get(section.toLowerCase())?.bare ?? [])];
  }
}

/** A whole string (after trimming) as a number, else undefined. */
export function parseNumber(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const t = s.trim();
  if (!t || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return undefined;
  return Number(t);
}
