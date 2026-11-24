#!/usr/bin/env python3
"""Print when the boot-path functions were first called in a coverage log (docs/BOOT.md).

usage: boot_trace.py <coverage_log.csv> <coverage_functions.txt>
The log's address column is an RVA (address - image base 0x400000); the function list holds VAs.
Only FIRST calls are logged, so this gives the order and the first-call times, not every state transition."""
import csv, sys

BASE = 0x400000
KEY = [(0xAD2451, 'entry'), (0x542B20, 'WinMain'), (0x4EF4D0, 'LoadSkipFrontEndSetting'), (0x4EF580, 'ShouldSkipFrontEnd'),
       (0x45E720, 'LH_MasterGameLoop'), (0x45E220, 'GameStateManager_Constructor'), (0x45E3F0, 'UpdateIntroSplashScreens'),
       (0x45E090, 'show image'), (0x45E1D0, 'free image (leaving a splash)'), (0x9ECDA0, 'LogoScreen_Initialize'),
       (0x9EC8F0, 'LH_State_IntroSplashScreen'), (0x45E000, 'CIntroScreenManager dtor'), (0x447C30, 'Game_MainLoop'),
       (0x4291C0, 'main object ctor'), (0x4244A0, 'Game_Bootstrap'), (0x695460, 'WFrontEnd (first function)'),
       (0x6921C0, 'WFrontEnd_Tick')]

def main(log, funcs):
    names = {}
    for line in open(funcs):
        a, n = line.split(None, 1)
        names[int(a, 16)] = n.strip()
    rows = {int(r[4], 16) + BASE: (int(r[0]), int(r[1])) for r in csv.reader(open(log)) if r and r[0].isdigit()}
    print('%d first-calls logged' % len(rows))
    for a, what in KEY:
        r = rows.get(a)
        print('%08X %-36s %s' % (a, what, 'seq %d  %.3f s' % (r[0], r[1] / 1e6) if r else 'not logged'))

if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
