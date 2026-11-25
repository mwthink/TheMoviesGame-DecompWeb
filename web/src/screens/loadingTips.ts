import type { Strings } from "../formats/Lhts.ts";

/**
 * The text of the original's loading screens (docs/LOADING_SCREENS.md).
 *
 * [read] Each load shows one random tip from the string database: `Localize_PickRandomText` (orig 0x009B7190) picks one of the group named `SPLASHSCREEN_TIPS`
 * (`rand % count`), and `SplashTip_BuildHtml` (orig 0x005E68A0) lays it out in an HTML table: the text before the first `<br><br>` is the heading (style `<x0>`,
 * centred), then a 10 px gap, then the rest in black (`<font color=#000000>`); a tip with no `<br><br>` is shown as it is. [inferred] The group is the
 * `FRONTEND_SPLASHSCREEN_<n>` entries (n = 10, 20 ...; about 26), each "Heading<br><br>Body".
 */
export interface Tip {
  /** The key it came from, e.g. `FRONTEND_SPLASHSCREEN_10`. */
  key: string;
  /** The short title ("Lot Management"); "" when the tip has none. */
  heading: string;
  /** The tip itself, with line breaks as `\n`. */
  body: string;
}

/**
 * Where the speech-bubble box is in every loading picture, as fractions of the 1024 x 1024 image (measured on the pixels: the box fill (166, 183, 213) spans
 * x 0.170 to 0.811 and y 0.570 to 0.964, identical in all 17 pictures). The game's own text goes inside it; so does ours.
 */
export const LOADING_BOX = { x: 0.17, y: 0.57, width: 0.641, height: 0.394 } as const;

const KEY = /^FRONTEND_SPLASHSCREEN_\d+$/;

/** The keys of the tips in a string database, in numeric order. */
export function tipKeys(strings: Strings): string[] {
  return [...strings.keys()].filter((k) => KEY.test(k)).sort((a, b) => Number(a.split("_").pop()) - Number(b.split("_").pop()));
}

/** Split a tip's raw text into heading and body, and turn the remaining markup (`<br>`) into plain text. */
export function parseTip(key: string, raw: string): Tip {
  const at = raw.indexOf("<br><br>");
  const plain = (s: string) => s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "").trim();
  if (at < 0) return { key, heading: "", body: plain(raw) };
  return { key, heading: plain(raw.slice(0, at)), body: plain(raw.slice(at + "<br><br>".length)) };
}

/** One tip chosen uniformly at random (`random` gives 0 <= r < 1), or null when the database has none. */
export function pickTip(strings: Strings | null, random: () => number = Math.random): Tip | null {
  if (!strings) return null;
  const keys = tipKeys(strings);
  if (!keys.length) return null;
  const key = keys[Math.min(keys.length - 1, Math.floor(random() * keys.length))]!;
  return parseTip(key, strings.get(key)!);
}
