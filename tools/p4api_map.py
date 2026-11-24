#!/usr/bin/env python3
"""Write p4api_map.csv: the functions of MoviesSE.exe that are the statically linked Perforce P4API client
(plus the zlib 1.0.4 it bundles), so they can be set aside as third-party code.

How it was found (see docs/NETWORK.md): the strings are P4's own (`P4PORT`, `P4CONFIG`, `NetTcpTransport_send`, `Rpc_dispatch`,
`NetBuffer_send_compressing`, AppleSingle, charset tables), and NetBuffer compression calls the *second* zlib copy
(`*_copy2`, version string "1.0.4"; the game itself uses the first copy, 1.1.4).
The P4 objects are interleaved with unrelated game code (the pak writer at 0xaafeb0-0xab4df0, FX, fonts, ...), so membership is the
component of direct calls around the anchors inside 0xa9d000-0xac8000, minus functions that carry game strings.

Columns: addr, name, size, sub (net | config | file | charset | zlib-1.0.4 | other), evidence, old_class (what
class_attribution.csv says; tools/attribute_classes.py applies this file over it when it is present).
Needs docs/generated/class_attribution.csv (only for old_class) and tools/ghidra_names.csv + renames.csv.
"""
import os, re, sys, csv
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import callgraph as cg

down, up, disp, size, byname = cg.load()
I = lambda a: int(a, 16)
funcs = {}
for fn in sorted(os.listdir(cg.EXP)):
    if not fn.startswith('decomp_'): continue
    t = open(os.path.join(cg.EXP, fn), errors='replace').read()
    ms = list(cg.HDR.finditer(t))
    for i, m in enumerate(ms):
        funcs[m.group(2)] = t[m.end():(ms[i+1].start() if i+1 < len(ms) else len(t))]
old = {}
p = os.path.join(ROOT, 'docs/generated/class_attribution.csv')
if os.path.exists(p):
    old = {r['address'].lower(): r['class'] for r in csv.DictReader(open(p))}

LO, HI = 0xa9d000, 0xac8000
win = {a for a in funcs if LO <= I(a) < HI}
anchor = re.compile(r'P4[A-Z]+|s_P4|Rpc_|NetBuffer|NetTcp|client_OpenFile|"xfiles"|"server2"|AppleSingle|WSAStartup_failure|'
                    r'Can_t_clobber|NO_ERROR|1_0_4|RpcSendBuffer|RpcRecvBuffer|finish_handle|set_handle|anyError|compress[12]|'
                    r'flush[12]|funcHandler|himark|"protocol"|shiftjis|"registry"|COMPUTERNAME|"USERNAME"|VarArray|open_for_read|'
                    r'"commit"|"perms"|"confirm"|"decline"')
game = re.compile(r'Pak|pak |FX\\\\|Data\\\\|MUMBLE|EXPLOSION|\.anm|Fonts|bigtextures|CONOUT|TheMovies|Lionhead|mflash|_sp_gun')
excl = {a for a in win if game.search(funcs[a])}
comp = {a for a in win if anchor.search(funcs[a]) and a not in excl}
fr = list(comp)
while fr:
    a = fr.pop()
    for c in list(down[a]) + list(up.get(a, ())):
        if c in win and c not in comp and c not in excl: comp.add(c); fr.append(c)

# zlib copy 2 (1.0.4): the functions named *_copy2, plus unnamed functions only reachable from them
z = {a for a in funcs if 'copy2' in disp[a]}
fr = list(z)
while fr:
    a = fr.pop()
    for c in down[a]:
        if c in z or I(c) < 0xa30000 or I(c) >= 0xad2000: continue
        if all(u in z for u in up.get(c, ())): z.add(c); fr.append(c)
members = comp | z

subs = [('net', r'NetTcp|NetBuffer|Rpc|WSAStartup_failure|"protocol"|compress[12]|flush[12]|funcHandler|himark'),
        ('config', r'P4[A-Z]+|s_P4|COMPUTERNAME|"USERNAME"|"registry"'),
        ('file', r'open_for_read|AppleSingle|"perms"|"commit"|handle|mkdir|clobber|"confirm"|"decline"|client_OpenFile|VarArray'),
        ('charset', r'shiftjis|winansi|macosroman')]
def sub(a):
    if a in z: return 'zlib-1.0.4'
    b = funcs[a]
    if re.search(r'\b(socket|send|recv|connect|closesocket|getsockname|getpeername|gethostbyname|gethostbyaddr|WSAStartup|'
                 r'WSACleanup|WSAGetLastError|getservbyname|inet_addr|htons|ntohs)\s*\(', b) and I(a) >= 0xac6000: return 'net'
    for n, rx in subs:
        if re.search(rx, b): return n
    return 'other'
rows = []
for a in sorted(members, key=I):
    s = re.findall(r'"([^"\n]{3,40})"', funcs[a])
    rows.append((a, disp[a], size[a], sub(a), s[0] if s else '', old.get(a, '')))
with open(os.path.join(ROOT, 'p4api_map.csv'), 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['addr', 'name', 'size', 'sub', 'evidence', 'old_class']); w.writerows(rows)
import collections
print('members', len(rows), dict(collections.Counter(r[3] for r in rows)))
print('old class labels:', dict(collections.Counter(r[5] for r in rows).most_common(6)))
lo = [r[0] for r in rows]; print('range', lo[0], lo[-1])
