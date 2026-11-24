#!/usr/bin/env python3
"""Reader for The Movies' string database (`Data/text/<lang>/stringdatabase.lhts`, plus `stringdatabase_addon1.lhts`).

    python3 tools/lhts.py "<game>/Data/text/EN-UK/stringdatabase.lhts" ROOM_SS_ACTORS ROOM_SS_ACTORS_2     # print entries
    python3 tools/lhts.py "<file>" --grep ROOM_                                                              # list keys containing text

Layout, as read from the shipped file (not checked against the loader): "LHTS" 01 02, a database name ("TheMoviesAddOn") and language ("en-uk"), a few header
bytes, then entries: zero bytes (end of the previous text), a 2-byte non-zero header (the second byte counts up through a run of entries), the key
(ASCII, NUL-terminated, case as written, e.g. `ROOM_SS_ACTORS`), `00 ff 00`, the text as UTF-16LE up to a 00 00 terminator. The game's `Localize(key)` looks keys up here.
The text is game content: keep it under data/ or just print it, do not commit it.
"""
import re
import sys

ENTRY = re.compile(rb"\x00[\x01-\xff][\x01-\xff]([A-Za-z0-9_]+)\x00\x00\xff\x00")


def load(*paths):
    """{KEY: text}; later files override earlier ones (addon over base)."""
    out = {}
    for path in paths:
        d = open(path, "rb").read()
        for m in ENTRY.finditer(d):
            i = m.end()
            k = i
            while k + 1 < len(d) and not (d[k] == 0 and d[k + 1] == 0):
                k += 2
            out[m.group(1).decode("latin1")] = d[i:k].decode("utf-16le", errors="replace")
    return out


# Rooms flagged "fire/can it" (part name contains _fire or _canit, FUN_00a14bd0) are drawn from five preloaded strings instead of their own key, chosen
# at run time (the table index DAT_010b93a4): the text depends on what the player is holding. Which one is held when is inferred, not traced.
FIRE_KEYS = ["ROOM_FIRE_STAFF", "ROOM_FIRE_SCRIPT", "ROOM_FIRE_WANABE"]
NO_TEXT = ("room_", "hall", "window")


def room_lines(strings, part_name):
    """The text the game puts on a room floor: the part name as the key, plus `<key>_2` as a second line. Fire rooms: all three fire texts joined with '/'.
    Hallways, windows and the unnamed whole-floor part have no key and no text. -> list of lines (may be empty)."""
    key = part_name.upper()
    if "_FIRE" in key or "_CANIT" in key:
        t = [strings[k] for k in FIRE_KEYS if k in strings]
        return ["/".join(t)] if t else []
    lines = [strings[k] for k in (key, key + "_2") if k in strings]
    return lines


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    s = load(sys.argv[1])
    if sys.argv[2] == "--grep":
        for k, v in sorted(s.items()):
            if sys.argv[3].lower() in k.lower() or sys.argv[3].lower() in v.lower():
                print(f"{k:50s} {v[:100]}")
    else:
        for k in sys.argv[2:]:
            print(f"{k}: {s.get(k)!r}")
