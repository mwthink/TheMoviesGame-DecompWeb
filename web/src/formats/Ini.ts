/**
 * The game's .ini dialect (see src/core/Ini in the C++ port): `[section]` headers, `key = value`, `#` comments, keys before the first section,
 * a trailing `;`. Keys are case-insensitive. Sections like `[a/b]` are kept as written (lower case).
 */
export class Ini {
  private readonly values = new Map<string, string>();

  static parse(text: string): Ini {
    const ini = new Ini();
    let section = "";
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("[")) {
        const end = line.indexOf("]");
        section = (end > 0 ? line.slice(1, end) : line.slice(1)).trim().toLowerCase();
        continue;
      }
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim().toLowerCase();
      let value = line.slice(eq + 1).trim();
      if (value.endsWith(";")) value = value.slice(0, -1).trim();
      const full = section ? `${section}/${key}` : key;
      if (!ini.values.has(full)) ini.values.set(full, value);
    }
    return ini;
  }

  get(key: string): string | undefined {
    return this.values.get(key.toLowerCase());
  }
}
