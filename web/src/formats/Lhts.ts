/**
 * The game's string database (`Data/text/<lang>/stringdatabase.lhts`, plus `stringdatabase_addon1.lhts`): a port of `tools/lhts.py`.
 * Layout as read from the shipped file (not checked against the loader): "LHTS", a header, then entries: a zero byte, a 2-byte non-zero header, the key (ASCII, NUL-terminated),
 * `00 ff 00`, the text as UTF-16LE up to a 00 00 terminator. Later files override earlier ones. The text is game content: it is read from the player's own install and never stored.
 */
export type Strings = Map<string, string>;

const ENTRY = /\x00[\x01-\xff][\x01-\xff]([A-Za-z0-9_]+)\x00\x00\xff\x00/g;

/** Add the entries of one file to `into`. */
export function parseLhts(d: Uint8Array, into: Strings = new Map()): Strings {
  let latin = "";
  for (let i = 0; i < d.length; i += 0x8000) latin += String.fromCharCode(...d.subarray(i, i + 0x8000));
  const utf16 = new TextDecoder("utf-16le");
  ENTRY.lastIndex = 0;
  for (let m = ENTRY.exec(latin); m; m = ENTRY.exec(latin)) {
    const start = m.index + m[0].length;
    let end = start;
    while (end + 1 < d.length && !(d[end] === 0 && d[end + 1] === 0)) end += 2;
    into.set(m[1]!, utf16.decode(d.subarray(start, end)));
  }
  return into;
}

/** A fire room (part name containing _fire or _canit) is drawn from five strings chosen at run time (docs/SAVE_FORMAT.md); the three that name what the room does, joined. */
const FIRE_KEYS = ["ROOM_FIRE_STAFF", "ROOM_FIRE_SCRIPT", "ROOM_FIRE_WANABE"];

/** The text the game puts on a room floor: the part name upper-cased is the key, `<key>_2` is a second line. No key, no text (hallways, windows, the whole-floor part). */
export function roomLines(strings: Strings, partName: string): string[] {
  const key = partName.toUpperCase();
  if (key.includes("_FIRE") || key.includes("_CANIT")) {
    const t = FIRE_KEYS.map((k) => strings.get(k)).filter((s): s is string => s !== undefined);
    return t.length ? [t.join("/")] : [];
  }
  return [key, `${key}_2`].map((k) => strings.get(k)).filter((s): s is string => s !== undefined);
}
