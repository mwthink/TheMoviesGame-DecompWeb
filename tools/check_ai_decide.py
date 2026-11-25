#!/usr/bin/env python3
"""Check the AI release-decision model (docs/MOVIE_SUCCESS.md 3m) against a decade_log.csv.

Rebuilds desire/score from the logged successDiff values (AI_DECIDE, AI_MAKE_MOVIE) and prints the score at each logged release
and the highest score at a decision that did not release. The model says a studio releases when score > 0.5.

Usage: tools/check_ai_decide.py data/runtime/<run>/decade_log.csv
Result on run4 (2026-11-21): release scores 0.463-0.513, highest non-release decision 0.477 -> consistent with the threshold
but not exact. The log has no mean/rms/desire, so it cannot be called verified (needs a hook on 0x5154A0 logging them).
"""
import math, sys

DIFF_T, DIFF_M, DEV_T, DEV_M, MIN_GAP, MAX_GAP, THRESH = 0.1, 3.0, 0.2, 12.0, 0.5, 2.0, 0.5

def rows(path, ev):
    with open(path) as f:
        return [dict(kv.split('=', 1) for kv in l.strip().split(',')) for l in f if f'ev={ev},' in l]

def score(sd, since, vals, stats=None):
    # stats = (mean, rms) as logged by the game (tracer version with released=); else rebuilt from the latest successDiff per studio
    mean, rms = stats if stats else (sum(vals) / len(vals), math.sqrt(sum(v * v for v in vals) / len(vals)))
    desire = min(1.0, max(0.0, (DIFF_T - mean) * DIFF_M + (DEV_T - rms) * DEV_M * sd))
    elapsed, half = since - MIN_GAP, (MAX_GAP - MIN_GAP) * 0.5
    if elapsed < half:
        return desire, desire * elapsed / half
    return desire, desire + (1 - desire) * (elapsed - half) / half

def main(path):
    ev = sorted([(float(r['year']), 'D', r) for r in rows(path, 'AI_DECIDE')] +
                [(float(r['year']), 'M', r) for r in rows(path, 'AI_MAKE_MOVIE')], key=lambda e: e[0])
    exact = any('mean' in r for _, k, r in ev if k == 'D')
    cur, best_no, rel = {}, 0.0, []
    for year, kind, r in ev:
        cur[r['studio']] = float(r['successDiff'])
        vals, sd = list(cur.values()), float(r['successDiff'])
        if kind == 'D' and 'mean' in r:     # exact path: the game's own mean/rms, and whether this call released
            d, s = score(sd, float(r['sinceLastYears']), vals, (float(r['mean']), float(r['rms'])))
            if r['released'] == '1':
                rel.append(s); print(f'release {year:.4f} desire={d:.3f} score={s:.3f} (logged mean/rms)')
            else:
                best_no = max(best_no, s)
        elif kind == 'D' and not exact:
            best_no = max(best_no, score(sd, float(r['sinceLastYears']), vals)[1])
        elif kind == 'M' and not exact:
            d, s = score(sd, year - float(r['lastReleaseYear']), vals)
            print(f'release {year:.4f} studios={len(vals)} desire={d:.3f} score={s:.3f}')
    print(f'highest score at a decision without a release: {best_no:.3f} (threshold {THRESH})')

if __name__ == '__main__':
    main(sys.argv[1])
