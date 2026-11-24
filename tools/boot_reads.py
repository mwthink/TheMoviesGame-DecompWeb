#!/usr/bin/env python3
"""Group the NtReadFile calls in a Wine +file,+timestamp trace into bursts (docs/BOOT.md, intro timing).

Record the trace with a plain launch (no injector):
  wine --bottle tmovies --debugmsg -all,+file,+timestamp --cx-log FILE --workdir 'C:\\Games\\TheMovies' 'C:\\Games\\TheMovies\\MoviesSE.exe'
usage: boot_reads.py <wine_trace.log> [gap_seconds=0.4]
Times are seconds from the first trace line. Image names are not visible (the splash images come out of the pak by index),
so a burst is only 'some asset I/O'; match it to a splash by position."""
import re, sys

def main(path, gap=0.4):
    t0, reads = None, []
    for line in open(path, errors='replace'):
        m = re.match(r'(\d+\.\d+):', line)
        if not m:
            continue
        t = float(m.group(1))
        t0 = t if t0 is None else t0
        if 'NtReadFile' in line and 'NtReadFile =' not in line:
            reads.append(t - t0)
    bursts, start, prev, n = [], None, None, 0
    for t in reads:
        if prev is None or t - prev > gap:
            if prev is not None:
                bursts.append((start, prev, n))
            start, n = t, 0
        n += 1
        prev = t
    if prev is not None:
        bursts.append((start, prev, n))
    last = None
    for s, e, n in bursts:
        print('%7.2f - %7.2f  %4d reads%s' % (s, e, n, '' if last is None else '   (+%.2f s since the previous burst)' % (s - last)))
        last = s

if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 0.4)
