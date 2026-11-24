#!/usr/bin/env python3
"""Match the functions of two builds of one code base (MoviesSE.exe and StarMaker.exe) from the fingerprint tables of ghidra/scripts/FunctionHashes.java.

    python3 tools/match_binaries.py <small.tsv> <large.tsv> [--names tools/ghidra_names.csv] [--out DIR] [--lookup ADDR ...]

    FunctionHashes.java writes the tables (see docs/STARMAKER.md section 2): address, size, instruction count, name, h_mnem, h_norm, call count, strings.
    <small.tsv> is the binary to explain (StarMaker), <large.tsv> the one to match against (MoviesSE).

Matching, per function of the small binary:
    1:1        its h_norm (mnemonics + operands with addresses and numbers >= 0x100000 replaced) occurs once in each binary
    ambiguous  the h_norm occurs in the large binary but is shared (small functions, CRT/STL templates): the first candidate is kept, but not counted as confident
    mnemonic   no h_norm match, but the mnemonic hash is unique in the large binary and the function has at least 12 instructions (a weaker match)
    none       nothing matches: editor-only code, or code that changed between the two builds (both look the same here)

Prints the counts, the share of code bytes with no match, how many confident matches land on functions that already have a real name in --names
(address,name CSV of the live Ghidra project: tools/ghidra_names.csv), and with --lookup the small-binary counterpart of the given large-binary
addresses. --out writes matches.json ([small addr, large addr, large name or null, size, kind], confident ones only) and unmatched.json
([addr, size, instructions, strings]).

Measured on 2026-11-24: StarMaker 11,000 functions vs MoviesSE 59,095: 5,567 1:1, 4,858 ambiguous, 43 mnemonic-only, 532 none (183 KB, 11.5% of the code bytes).
"""
import argparse
import collections
import csv
import json
import os


def load(path):
    rows = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            p = line.rstrip("\n").split("\t")
            p += [""] * (8 - len(p))
            rows.append({"addr": p[0], "size": int(p[1]), "n": int(p[2]), "name": p[3], "hm": p[4], "hn": p[5], "calls": int(p[6]), "strs": p[7]})
    return rows


def norm_addr(a):
    return a.lower().lstrip("0")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("small")
    ap.add_argument("large")
    ap.add_argument("--names", help="address,name CSV of the large binary's live Ghidra names")
    ap.add_argument("--out", help="folder for matches.json and unmatched.json")
    ap.add_argument("--lookup", nargs="*", default=[], help="addresses of the large binary whose counterpart in the small one is wanted")
    a = ap.parse_args()
    small, large = load(a.small), load(a.large)
    names = {}
    if a.names:
        for r in csv.reader(open(a.names)):
            if len(r) >= 2 and r[0] != "address":
                names[norm_addr(r[0])] = r[1]
    by_norm, by_mnem = collections.defaultdict(list), collections.defaultdict(list)
    for r in large:
        by_norm[r["hn"]].append(r)
        by_mnem[r["hm"]].append(r)
    small_norm = collections.Counter(r["hn"] for r in small)
    matches, unmatched = [], []
    counts = collections.Counter()
    for r in small:
        c = by_norm.get(r["hn"], [])
        if len(c) == 1 and small_norm[r["hn"]] == 1:
            matches.append((r, c[0], "1:1"))
            counts["1:1"] += 1
        elif c:
            matches.append((r, c[0], "ambiguous"))
            counts["ambiguous"] += 1
        else:
            c2 = by_mnem.get(r["hm"], [])
            if len(c2) == 1 and r["n"] >= 12:
                matches.append((r, c2[0], "mnemonic"))
                counts["mnemonic"] += 1
            else:
                unmatched.append(r)
                counts["none"] += 1
    total_bytes = sum(r["size"] for r in small)
    none_bytes = sum(r["size"] for r in unmatched)
    print("%s: %d functions; %s: %d functions" % (os.path.basename(a.small), len(small), os.path.basename(a.large), len(large)))
    print("1:1 %d, ambiguous %d, mnemonic-only %d, none %d" % (counts["1:1"], counts["ambiguous"], counts["mnemonic"], counts["none"]))
    print("code bytes: %d, without a match: %d (%.1f%%); unmatched >= 200 bytes: %d, >= 1000 bytes: %d" %
          (total_bytes, none_bytes, 100.0 * none_bytes / max(1, total_bytes), sum(1 for r in unmatched if r["size"] >= 200), sum(1 for r in unmatched if r["size"] >= 1000)))
    confident = [(s, m, k) for s, m, k in matches if k != "ambiguous"]
    if names:
        named = [1 for s, m, k in confident if names.get(norm_addr(m["addr"]), "FUN_").startswith("FUN_") is False]
        print("confident matches that land on a function with a real name in %s: %d" % (os.path.basename(a.names), len(named)))
    by_large = {norm_addr(m["addr"]): (s, m, k) for s, m, k in matches}
    for addr in a.lookup:
        hit = by_large.get(norm_addr(addr))
        print("%s -> %s" % (addr, ("%s (%d bytes, %s match)" % (hit[0]["addr"], hit[0]["size"], hit[2])) if hit else "no match"))
    if a.out:
        os.makedirs(a.out, exist_ok=True)
        json.dump([[s["addr"], m["addr"], names.get(norm_addr(m["addr"])), s["size"], k] for s, m, k in confident], open(os.path.join(a.out, "matches.json"), "w"))
        json.dump([[r["addr"], r["size"], r["n"], r["strs"]] for r in unmatched], open(os.path.join(a.out, "unmatched.json"), "w"))


if __name__ == "__main__":
    main()
