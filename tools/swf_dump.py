#!/usr/bin/env python3
"""Dump the structure and the ActionScript of an SWF file (version 4 to 6; the game's .mfl files are such files).

  python3 tools/swf_dump.py <file.mfl>            tags, instance names, and every action block as pseudo-code
  python3 tools/swf_dump.py <file.mfl> --calls    only the game calls: where each fscommand / getURL / Extern* / cb_* call sits

What it reads: the header, the tag stream (with DefineSprite nesting and frame counting), PlaceObject / PlaceObject2 (instance names and
clip actions), DefineButton / DefineButton2 (button actions and the event each runs on), DoAction / DoInitAction, FrameLabel,
DefineEditText (variable names), and ActionScript 1 bytecode (the SWF 4 to 6 action set). The pseudo-code is a plain stack
walk: conditional jumps are printed as `if (...) goto Lxxxx`, not rebuilt into blocks. Compressed (CWS) files are inflated with zlib.
Not decoded: shapes, fonts, bitmaps, sounds, filters; DefineFunction bodies are printed inline but not indented as functions."""
import struct
import sys
import zlib

TAGS = {0: 'End', 1: 'ShowFrame', 2: 'DefineShape', 4: 'PlaceObject', 5: 'RemoveObject', 6: 'DefineBits', 7: 'DefineButton', 9: 'SetBackgroundColor',
        10: 'DefineFont', 11: 'DefineText', 12: 'DoAction', 13: 'DefineFontInfo', 14: 'DefineSound', 20: 'DefineBitsLossless', 21: 'DefineBitsJPEG2',
        22: 'DefineShape2', 24: 'Protect', 26: 'PlaceObject2', 28: 'RemoveObject2', 32: 'DefineShape3', 33: 'DefineText2', 34: 'DefineButton2',
        35: 'DefineBitsJPEG3', 36: 'DefineBitsLossless2', 37: 'DefineEditText', 39: 'DefineSprite', 43: 'FrameLabel', 45: 'SoundStreamHead2',
        46: 'DefineMorphShape', 48: 'DefineFont2', 56: 'ExportAssets', 57: 'ImportAssets', 59: 'DoInitAction', 69: 'FileAttributes'}

OPS = {0x04: 'nextFrame', 0x05: 'prevFrame', 0x06: 'play', 0x07: 'stop', 0x08: 'toggleQuality', 0x09: 'stopSounds', 0x0A: 'add', 0x0B: 'subtract',
       0x0C: 'multiply', 0x0D: 'divide', 0x0E: 'equals', 0x0F: 'less', 0x10: 'and', 0x11: 'or', 0x12: 'not', 0x13: 'stringEquals', 0x14: 'stringLength',
       0x15: 'stringExtract', 0x17: 'pop', 0x18: 'toInteger', 0x1C: 'getVariable', 0x1D: 'setVariable', 0x20: 'setTarget2', 0x21: 'stringAdd',
       0x22: 'getProperty', 0x23: 'setProperty', 0x24: 'cloneSprite', 0x25: 'removeSprite', 0x26: 'trace', 0x27: 'startDrag', 0x28: 'endDrag',
       0x29: 'stringLess', 0x30: 'randomNumber', 0x34: 'getTime', 0x3A: 'delete', 0x3B: 'delete2', 0x3C: 'defineLocal', 0x3D: 'callFunction',
       0x3E: 'return', 0x3F: 'modulo', 0x40: 'newObject', 0x41: 'defineLocal2', 0x42: 'initArray', 0x43: 'initObject', 0x44: 'typeOf',
       0x45: 'targetPath', 0x46: 'enumerate', 0x47: 'add2', 0x48: 'less2', 0x49: 'equals2', 0x4A: 'toNumber', 0x4B: 'toString', 0x4C: 'pushDuplicate',
       0x4D: 'stackSwap', 0x4E: 'getMember', 0x4F: 'setMember', 0x50: 'increment', 0x51: 'decrement', 0x52: 'callMethod', 0x53: 'newMethod',
       0x54: 'instanceOf', 0x55: 'enumerate2', 0x60: 'bitAnd', 0x61: 'bitOr', 0x62: 'bitXor', 0x63: 'bitLShift', 0x64: 'bitRShift', 0x65: 'bitURShift',
       0x66: 'strictEquals', 0x67: 'greater', 0x68: 'stringGreater', 0x81: 'gotoFrame', 0x83: 'getURL', 0x87: 'storeRegister', 0x88: 'constantPool',
       0x8A: 'waitForFrame', 0x8B: 'setTarget', 0x8C: 'gotoLabel', 0x8D: 'waitForFrame2', 0x8E: 'defineFunction2', 0x94: 'with', 0x96: 'push',
       0x99: 'jump', 0x9A: 'getURL2', 0x9B: 'defineFunction', 0x9D: 'if', 0x9E: 'call', 0x9F: 'gotoFrame2'}

BIN = {'add': '+', 'subtract': '-', 'multiply': '*', 'divide': '/', 'equals': '==', 'less': '<', 'and': '&&', 'or': '||', 'stringEquals': 'eq',
       'stringLess': 'lt', 'add2': '+', 'less2': '<', 'equals2': '==', 'modulo': '%', 'bitAnd': '&', 'bitOr': '|', 'bitXor': '^', 'strictEquals': '===',
       'greater': '>', 'stringAdd': 'add', 'stringGreater': 'gt'}

BUTTON_EVENTS = {0x01: 'idle->overUp', 0x02: 'overUp->idle', 0x04: 'press', 0x08: 'release', 0x10: 'dragOut', 0x20: 'dragOver',
                 0x40: 'releaseOutside', 0x80: 'idle->overDown', 0x100: 'overDown->idle'}
CLIP_EVENTS = ['load', 'enterFrame', 'unload', 'mouseMove', 'mouseDown', 'mouseUp', 'keyDown', 'keyUp', 'data']


class Reader:
    def __init__(self, data, pos=0):
        self.d, self.p = data, pos

    def u8(self):
        v = self.d[self.p]; self.p += 1; return v

    def u16(self):
        v = struct.unpack_from('<H', self.d, self.p)[0]; self.p += 2; return v

    def u32(self):
        v = struct.unpack_from('<I', self.d, self.p)[0]; self.p += 4; return v

    def cstr(self):
        e = self.d.index(b'\0', self.p); s = self.d[self.p:e].decode('latin1'); self.p = e + 1; return s

    def bits(self, n):
        v = 0
        for _ in range(n):
            byte = self.d[self.p + (self._b >> 3)]
            v = (v << 1) | ((byte >> (7 - (self._b & 7))) & 1)
            self._b += 1
        return v

    def bit_start(self): self._b = 0

    def bit_end(self): self.p += (self._b + 7) >> 3


def rect(r):
    r.bit_start(); n = r.bits(5)
    for _ in range(4): r.bits(n)
    r.bit_end()


def matrix(r):
    r.bit_start()
    if r.bits(1):
        n = r.bits(5); r.bits(n); r.bits(n)
    if r.bits(1):
        n = r.bits(5); r.bits(n); r.bits(n)
    n = r.bits(5); r.bits(n); r.bits(n)
    r.bit_end()


def cxform(r, alpha):
    r.bit_start(); add = r.bits(1); mul = r.bits(1); n = r.bits(4)
    k = 4 if alpha else 3
    if mul:
        for _ in range(k): r.bits(n)
    if add:
        for _ in range(k): r.bits(n)
    r.bit_end()


# ---- ActionScript ---------------------------------------------------------------------------------------------------

def decode_actions(data, pool=None):
    """-> list of (offset, name, args). The constant pool is carried through as `pool`."""
    r = Reader(data)
    out = []
    pool = list(pool or [])
    while r.p < len(data):
        off = r.p
        op = r.u8()
        if op == 0:
            out.append((off, 'end', [])); break
        name = OPS.get(op, 'op%02X' % op)
        if op < 0x80:
            out.append((off, name, [])); continue
        n = r.u16(); end = r.p + n; sub = Reader(data, r.p)
        args = []
        if op == 0x96:                                   # push
            while sub.p < end:
                t = sub.u8()
                if t == 0: args.append(('s', sub.cstr()))
                elif t == 1: args.append(('f', struct.unpack_from('<f', data, sub.p)[0])); sub.p += 4
                elif t == 2: args.append(('null', None))
                elif t == 3: args.append(('undef', None))
                elif t == 4: args.append(('reg', sub.u8()))
                elif t == 5: args.append(('b', bool(sub.u8())))
                elif t == 6:
                    hi, lo = struct.unpack_from('<II', data, sub.p); sub.p += 8
                    args.append(('f', struct.unpack('<d', struct.pack('<II', lo, hi))[0]))
                elif t == 7: args.append(('i', struct.unpack_from('<i', data, sub.p)[0])); sub.p += 4
                elif t == 8: args.append(('s', pool[sub.u8()] if sub.d[sub.p - 1] < len(pool) else '#c%d' % sub.d[sub.p - 1]))
                elif t == 9: k = sub.u16(); args.append(('s', pool[k] if k < len(pool) else '#c%d' % k))
                else: args.append(('?', t)); break
        elif op == 0x88:                                 # constantPool
            cnt = sub.u16(); pool = [sub.cstr() for _ in range(cnt)]; args = [('pool', list(pool))]
        elif op == 0x83: args = [('s', sub.cstr()), ('s', sub.cstr())]
        elif op == 0x8B: args = [('s', sub.cstr())]
        elif op == 0x8C: args = [('s', sub.cstr())]
        elif op == 0x81: args = [('i', sub.u16())]
        elif op in (0x99, 0x9D): args = [('off', struct.unpack_from('<h', data, sub.p)[0] + end)]
        elif op == 0x9A: args = [('i', sub.u8())]
        elif op == 0x9F: args = [('i', sub.u8())]
        elif op == 0x87: args = [('reg', sub.u8())]
        elif op == 0x9B:                                  # defineFunction(name, params..., codeSize)
            fname = sub.cstr(); np = sub.u16(); params = [sub.cstr() for _ in range(np)]; size = sub.u16()
            args = [('s', fname), ('params', params), ('size', size)]
            out.append((off, name, args)); r.p = end
            out.extend(decode_actions(data[end:end + size], pool)); r.p = end + size
            continue
        elif op == 0x8E:                                  # defineFunction2
            fname = sub.cstr(); np = sub.u16(); nreg = sub.u8(); flags = sub.u16()
            params = []
            for _ in range(np):
                reg = sub.u8(); params.append((reg, sub.cstr()))
            size = sub.u16()
            args = [('s', fname), ('params', params), ('size', size)]
            out.append((off, name, args)); r.p = end
            out.extend(decode_actions(data[end:end + size], pool)); r.p = end + size
            continue
        else:
            args = [('raw', data[sub.p:end].hex())]
        out.append((off, name, args))
        r.p = end
    return out


def fmt(a):
    k, v = a
    if k == 's': return repr(v)
    if k == 'f': return ('%g' % v)
    if k == 'b': return 'true' if v else 'false'
    if k in ('null', 'undef'): return k
    if k == 'reg': return 'r%d' % v
    return str(v)


def pseudo(actions):
    """A plain stack walk. Returns lines of text. Calls and assignments become statements."""
    st, lines = [], []
    for off, name, args in actions:
        a = lambda: st.pop() if st else '?'
        if name == 'push': st.extend(fmt(x) for x in args)
        elif name == 'constantPool': lines.append('%04x constantPool(%d strings)' % (off, len(args[0][1])))
        elif name == 'getVariable': st.append(a())
        elif name == 'setVariable': v = a(); k = a(); lines.append('%04x %s = %s' % (off, k.strip("'"), v))
        elif name == 'getMember': m = a(); o = a(); st.append('%s.%s' % (o, m.strip("'")))
        elif name == 'setMember': v = a(); m = a(); o = a(); lines.append('%04x %s.%s = %s' % (off, o, m.strip("'"), v))
        elif name == 'callFunction':
            f = a(); n = a(); n = int(float(n)) if n.replace('.', '', 1).lstrip('-').isdigit() else 0
            argv = [a() for _ in range(n)]
            lines.append('%04x %s(%s)' % (off, f.strip("'"), ', '.join(argv))); st.append('<result>')
        elif name == 'callMethod':
            m = a(); o = a(); n = a(); n = int(float(n)) if n.replace('.', '', 1).lstrip('-').isdigit() else 0
            argv = [a() for _ in range(n)]
            lines.append('%04x %s.%s(%s)' % (off, o, m.strip("'"), ', '.join(argv))); st.append('<result>')
        elif name == 'getURL': lines.append('%04x getURL(%s, %s)' % (off, repr(args[0][1]), repr(args[1][1])))
        elif name == 'getURL2': t = a(); u = a(); lines.append('%04x getURL2(%s, %s) [flags %s]' % (off, u, t, args[0][1]))
        elif name in BIN: b = a(); l = a(); st.append('(%s %s %s)' % (l, BIN[name], b))
        elif name == 'not': st.append('!%s' % a())
        elif name == 'pop': a()
        elif name == 'if': lines.append('%04x if (%s) goto L%04x' % (off, a(), args[0][1]))
        elif name == 'jump': lines.append('%04x goto L%04x' % (off, args[0][1]))
        elif name in ('play', 'stop', 'nextFrame', 'prevFrame', 'stopSounds', 'end'):
            if name != 'end': lines.append('%04x %s()' % (off, name))
        elif name == 'gotoFrame': lines.append('%04x gotoFrame(%d)' % (off, args[0][1] + 1))
        elif name == 'gotoLabel': lines.append('%04x gotoLabel(%r)' % (off, args[0][1]))
        elif name == 'setTarget': lines.append('%04x setTarget(%r)' % (off, args[0][1]))
        elif name == 'setTarget2': lines.append('%04x setTarget(%s)' % (off, a()))
        elif name in ('defineFunction', 'defineFunction2'):
            lines.append('%04x function %s(%s) {  // %d bytes follow' % (off, args[0][1], ', '.join(p if isinstance(p, str) else p[1] for p in args[1][1]), args[2][1]))
        elif name == 'storeRegister': lines.append('%04x r%d = %s' % (off, args[0][1], st[-1] if st else '?'))
        else: lines.append('%04x %s %s' % (off, name, ' '.join(fmt(x) for x in args)))
    return lines


# ---- Tags -----------------------------------------------------------------------------------------------------------

class Dump:
    def __init__(self, calls_only):
        self.calls_only = calls_only
        self.names = {}          # (parent sprite id, depth) -> instance name
        self.version = 0

    def out(self, indent, text):
        if not self.calls_only: print('  ' * indent + text)

    def block(self, indent, where, actions):
        lines = pseudo(actions)
        calls = [l for l in lines if '(' in l and not l.split(' ', 1)[1].startswith(('stop(', 'play(', 'gotoFrame', 'gotoLabel', 'setTarget', 'function ', 'constantPool', 'if ', 'goto '))]
        if self.calls_only:
            if calls:
                print('%s' % where)
                for l in calls: print('    ' + l)
        else:
            print('  ' * indent + where)
            for l in lines: print('  ' * (indent + 1) + l)

    def tags(self, data, indent, scope):
        r = Reader(data)
        frame = 1
        while r.p < len(data):
            hdr = r.u16(); tid, ln = hdr >> 6, hdr & 63
            if ln == 63: ln = r.u32()
            body = data[r.p:r.p + ln]; r.p += ln
            name = TAGS.get(tid, 'tag%d' % tid)
            where = '%s frame %d' % (scope, frame)
            if tid == 1:
                frame += 1
            elif tid == 43:
                self.out(indent, '%s: label %r' % (where, body[:-1].decode('latin1')))
            elif tid == 12:
                self.block(indent, '%s: DoAction' % where, decode_actions(body))
            elif tid == 59:
                self.block(indent, '%s: DoInitAction (sprite %d)' % (where, struct.unpack_from('<H', body)[0]), decode_actions(body[2:]))
            elif tid == 39:
                sid, nframes = struct.unpack_from('<HH', body)
                self.out(indent, '%s: DefineSprite %d (%d frames)' % (where, sid, nframes))
                self.tags(body[4:], indent + 1, 'sprite %d' % sid)
            elif tid in (26, 4):
                self.place(body, indent, where, tid)
            elif tid == 7:
                self.button1(body, indent, where)
            elif tid == 34:
                self.button2(body, indent, where)
            elif tid == 37:
                # DefineEditText: id, bounds, two flag bytes, then the optional parts in spec order
                rr = Reader(body); cid = rr.u16(); rect(rr)
                f1, f2 = rr.u8(), rr.u8()
                try:
                    if f1 & 0x01: rr.u16(); rr.u16()          # HasFont: font id, height
                    if f1 & 0x04: rr.u32()                    # HasTextColor
                    if f1 & 0x02: rr.u16()                    # HasMaxLength
                    if f2 & 0x20: rr.p += 9                   # HasLayout: align, margins, indent, leading
                    self.out(indent, '%s: DefineEditText %d variable %r' % (where, cid, rr.cstr()))
                except Exception:
                    self.out(indent, '%s: DefineEditText %d' % (where, cid))
            elif tid == 56:
                rr = Reader(body); n = rr.u16(); items = []
                for _ in range(n): cid = rr.u16(); items.append((cid, rr.cstr()))
                self.out(indent, '%s: ExportAssets %s' % (where, items))
            elif tid not in (0,) and not self.calls_only and tid in (9, 24, 69):
                self.out(indent, '%s: %s' % (where, name))

    def place(self, body, indent, where, tid):
        r = Reader(body)
        if tid == 4:
            cid = r.u16(); depth = r.u16(); self.out(indent, '%s: PlaceObject char %d depth %d' % (where, cid, depth)); return
        flags = r.u8(); depth = r.u16(); cid = r.u16() if flags & 0x02 else None
        if flags & 0x04: matrix(r)
        if flags & 0x08: cxform(r, True)
        if flags & 0x10: r.u16()
        name = r.cstr() if flags & 0x20 else None
        if flags & 0x40: r.u16()
        desc = 'PlaceObject2 depth %d%s%s%s' % (depth, '' if cid is None else ' char %d' % cid, '' if name is None else ' name %r' % name, ' (move)' if flags & 1 else '')
        self.out(indent, '%s: %s' % (where, desc))
        if flags & 0x80:
            r.u16()
            allflags = r.u32() if self.version >= 6 else r.u16()
            while r.p < len(body):
                ev = r.u32() if self.version >= 6 else r.u16()
                if ev == 0: break
                size = r.u32()
                key = None
                if ev & 0x20000: key = r.u8(); size -= 1
                acts = decode_actions(body[r.p:r.p + size]); r.p += size
                evn = [CLIP_EVENTS[i] for i in range(len(CLIP_EVENTS)) if ev & (1 << i)] + (['keyPress %d' % key] if key is not None else [])
                self.block(indent + 1, '%s: %s clip event %s%s' % (where, desc, '+'.join(evn) or hex(ev), ''), acts)

    def button_records(self, r, two):
        recs = []
        while True:
            fl = r.u8()
            if fl == 0: break
            cid = r.u16(); depth = r.u16(); matrix(r)
            if two: cxform(r, True)
            recs.append((cid, depth, [n for b, n in ((1, 'up'), (2, 'over'), (4, 'down'), (8, 'hit')) if fl & b]))
        return recs

    def button1(self, body, indent, where):
        r = Reader(body); bid = r.u16(); recs = self.button_records(r, False)
        self.out(indent, '%s: DefineButton %d (%d records)' % (where, bid, len(recs)))
        self.block(indent + 1, '%s: button %d on release' % (where, bid), decode_actions(body[r.p:]))

    def button2(self, body, indent, where):
        r = Reader(body); bid = r.u16(); r.u8(); off = r.u16(); start = r.p
        recs = self.button_records(r, True)
        self.out(indent, '%s: DefineButton2 %d (%d records)' % (where, bid, len(recs)))
        if off == 0: return
        p = start - 2 + off          # ActionOffset counts from the offset field itself
        while p < len(body):
            size = struct.unpack_from('<H', body, p)[0]
            cond = struct.unpack_from('<H', body, p + 2)[0]
            end = p + size if size else len(body)
            acts = decode_actions(body[p + 4:end])
            evn = [n for b, n in BUTTON_EVENTS.items() if cond & b]
            key = (cond >> 9) & 0x7F
            if key: evn.append('key %d' % key)
            self.block(indent + 1, '%s: button %d on %s' % (where, bid, '+'.join(evn) or hex(cond)), acts)
            if size == 0: break
            p += size


def main(path, calls_only):
    d = open(path, 'rb').read()
    sig, ver = d[:3], d[3]
    if sig == b'CWS': d = d[:8] + zlib.decompress(d[8:])
    elif sig != b'FWS': sys.exit('not an SWF: signature %r' % sig)
    length = struct.unpack_from('<I', d, 4)[0]
    r = Reader(d, 8); rect(r); rate = r.u16(); frames = r.u16()
    dump = Dump(calls_only); dump.version = ver
    if not calls_only:
        print('%s: %s v%d, declared length %d (actual %d), %.1f fps, %d frames' % (path, sig.decode(), ver, length, len(d), rate / 256.0, frames))
    dump.tags(d[r.p:], 0, 'root')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    main(args[0], '--calls' in sys.argv)
