#!/usr/bin/env python3
"""Write net_map.csv: every function of MoviesSE.exe that belongs to the
networking code, with the stack and layer it sits in and the evidence for putting it there.

Bottom-up: functions that call Winsock / wininet / iphlpapi directly, or carry HTTP / protocol strings, are seeds;
the component of direct calls around them (inside the address windows below) is the net library.
Top-down: functions of the online UI classes (and anything that mentions an ONLINE_* key, CDKey, ...) are tagged
by feature and marked `reaches_net` when a chain of direct calls (<= 4) gets from them into the library.
Direct calls only: virtual dispatch is invisible, so UI methods reached through vtables are tagged by class.

Stacks:  A = the game's own client (HTTPLib + MV protocol), B = the Perforce P4API socket layer (dev tooling).
Layers:  transport (Winsock/wininet users), http, protocol, glue (net-private helper), shared (also used elsewhere),
         ui, feature (non-UI caller that mentions CDKey / account / ...).
"""
import re, sys, os, csv, pickle, collections
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
cls = {r['address'].lower(): r['class'] for r in csv.DictReader(open(os.path.join(ROOT, 'docs/generated/class_attribution.csv')))}

API = (r'WSAStartup|WSACleanup|WSAGetLastError|WSAAsync\w+|WSAEvent\w+|WSASend\w*|WSARecv\w*|socket|closesocket|send|sendto|recv|'
       r'recvfrom|connect|bind|listen|accept|select|ioctlsocket|setsockopt|getsockopt|gethostbyname|gethostbyaddr|gethostname|'
       r'getservbyname|getpeername|getsockname|inet_addr|inet_ntoa|shutdown|Internet\w+|Http\w+|URLDownload\w+|WinHttp\w+|'
       r'__WSAFDIsSet|ntohs|ntohl|htons|htonl')
# Stack A imports WS2_32 by ordinal (wsock32-style), so the decompiler shows Ordinal_N(...)
WS_ORD = {1: 'accept', 2: 'bind', 3: 'closesocket', 4: 'connect', 5: 'getpeername', 6: 'getsockname', 7: 'getsockopt',
          8: 'htonl', 9: 'htons', 10: 'ioctlsocket', 11: 'inet_addr', 12: 'inet_ntoa', 13: 'listen', 14: 'ntohl', 15: 'ntohs',
          16: 'recv', 17: 'recvfrom', 18: 'select', 19: 'send', 20: 'sendto', 21: 'setsockopt', 22: 'shutdown', 23: 'socket',
          51: 'gethostbyaddr', 52: 'gethostbyname', 53: 'getprotobyname', 55: 'getservbyname', 57: 'gethostname',
          111: 'WSAGetLastError', 112: 'WSASetLastError', 115: 'WSAStartup', 116: 'WSACleanup'}
api_re = re.compile(r'\b(' + API + r'|Ordinal_(?:' + '|'.join(map(str, WS_ORD)) + r'))\s*\(')
def api_names(body):
    return sorted({WS_ORD[int(m[8:])] + '#' if m.startswith('Ordinal_') else m for m in api_re.findall(body)})
http_re = re.compile(r'HTTPLib|"GET |"POST |"http://|ServerCode|User-Agent|Content-Type|Content-Length|Location:|"http/1')
proto_re = re.compile(r'X-MoviesContent|"MV[X0-9]+:|"mv0[0-9]+:|Packet type not recognized')
ui_re = re.compile(r'ONLINE_|ONLINEOPTIONS_|CDKey|UserAccountName|movies\.lionhead|Proxy Server|"leagues"')
feat = [('upload', r'UPLOAD|upload'), ('download', r'_DL_|DOWNLOAD|downloaded_content'), ('league', r'LEAGUE|league'),
        ('propshop', r'PROPSHOP'), ('login/account', r'USERNAME_PASSWORD|USERACCOUNT|UserAccountName|LOGOUT|CDKey'),
        ('version-check', r'NEW_VERSION'), ('autoconfig/proxy', r'AUTOCONFIG|Proxy Server|SERVERPORT|ONLINEOPTIONS'),
        ('delete', r'DELETE')]

def inA(a): return 0x963000 <= I(a) < 0x971200
def inB(a): return 0xac6000 <= I(a) < 0xac7400 or a in ('00a9f9d0', 'abc330'.rjust(8, '0'))

seeds = {a for a, b in funcs.items() if api_re.search(b) or http_re.search(b) or proto_re.search(b) or 'Winsock Error' in b
         or 'GetAdaptersInfo' in b or 'wininet.dll' in b}
comp = {a for a in seeds if inA(a) or inB(a)}
fr = list(comp)
while fr:
    a = fr.pop()
    for c in list(down[a]) + list(up.get(a, ())):
        if c not in comp and (inA(c) or inB(c)): comp.add(c); fr.append(c)

# --- top-down: UI/feature functions
def isui(a):
    c = cls.get(a) or ''
    return bool(re.match(r'(TM::)?(WOnline|WLeague|COnlineLeague)', c)) or bool(ui_re.search(funcs[a]))
ui = {a for a in funcs if isui(a) and a not in comp}
# reaches net via <=4 direct calls
def reaches(a):
    seen = {a}; fr = [a]
    for _ in range(4):
        nx = []
        for x in fr:
            for c in down[x]:
                if c in comp: return True
                if c not in seen: seen.add(c); nx.append(c)
        fr = nx
    return False
# shared helpers: comp functions that are called from something that is neither comp nor UI nor a consumer of the stack
consumers = {c for a in comp for c in up.get(a, ()) if c not in comp and (c in ui or isui(c))}
def layer(a):
    b = funcs[a]
    if api_re.search(b) or 'Winsock Error' in b or 'GetAdaptersInfo' in b or 'wininet.dll' in b: return 'transport'
    if proto_re.search(b): return 'protocol'
    if http_re.search(b): return 'http'
    return None
rows = []
for a in sorted(comp, key=I):
    st = 'B' if inB(a) else 'A'; ly = layer(a)
    if ly is None:
        outs = [c for c in up.get(a, ()) if c not in comp]
        ly = 'shared' if any(c not in consumers and not isui(c) for c in outs) and (st == 'A' and not outs == []) else 'glue'
        if 'too long' in funcs[a]: ly = 'shared'
    ev = ''
    m = api_names(funcs[a])
    if m: ev = 'calls ' + ','.join(m)
    else:
        s = re.findall(r'"([^"\n]{3,40})"', funcs[a])
        ev = ('string ' + s[0]) if s else ''
    rows.append((a, disp[a], size[a], st, ly, ev, cls.get(a, '')))
for a in sorted(ui, key=I):
    f = next((n for n, p in feat if re.search(p, funcs[a])), '')
    ly = 'ui' if (cls.get(a) or '').lstrip('TM::').startswith(('WOnline', 'WLeague', 'COnline')) or 'ONLINE_' in funcs[a] else 'feature'
    rows.append((a, disp[a], size[a], 'A', ly, ('reaches_net ' if reaches(a) else 'ui_only ') + f, cls.get(a, '')))
with open(os.path.join(ROOT, 'net_map.csv'), 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['addr', 'name', 'size', 'stack', 'layer', 'evidence', 'class']); w.writerows(rows)
c = collections.Counter((r[3], r[4]) for r in rows)
print('seeds', len(seeds), 'comp', len(comp), 'ui/feature', len(ui))
for k, v in sorted(c.items()): print(k, v)
