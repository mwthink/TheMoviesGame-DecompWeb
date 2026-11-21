"""Shared helper: a C front end for the generated sources, on Windows (MSVC x86) or macOS/Linux (clang, i686 MinGW target).

The Ghidra pseudo-C assumes 32-bit x86 (pointers are `int`, `this` is ECX), so even off Windows the check uses a 32-bit
x86 target; nothing is linked or run. On macOS: `brew install mingw-w64` provides the Win32 headers.

  header_words(shim_dir)       identifiers defined by ghidra_shim.h and the system headers it pulls in
  check_cmd(src, cwd)          command line that syntax-checks one source file
  parse_errors(text)           [(file, line, kind, code, msg)] from compiler output (MSVC or clang style)
"""
import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile

IS_WINDOWS = os.name == 'nt'
VCVARS = r'C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars32.bat'
TARGET = 'i686-w64-mingw32'

# MSVC /Zs flags that silence what the old pipeline treated as warnings (C4244, C4047, C4024, C4013, C4133, C4101)
CLANG_FLAGS = ['-fsyntax-only', '-x', 'c', '-std=gnu99', '-fms-extensions', '-ferror-limit=0', '-w',
               '-Wno-error', '-Wno-return-mismatch', '-Wno-implicit-function-declaration', '-Wno-int-conversion',
               '-Wno-incompatible-pointer-types', '-Wno-incompatible-function-pointer-types',
               '-Wno-pointer-to-int-cast', '-Wno-int-to-pointer-cast']

MSVC_ERR = re.compile(r'^(?P<file>[^()\r\n]+)\((?P<line>\d+)(?:,\d+)?\)\s*:\s*(?P<kind>fatal error|error|warning)\s+(?P<code>C\d+)\s*:\s*(?P<msg>.*)$')
CLANG_ERR = re.compile(r'^(?P<file>.+?):(?P<line>\d+):\d+:\s*(?P<kind>fatal error|error|warning):\s*(?P<msg>.*)$')


def mingw_include():
    for root in (os.environ.get('MINGW_PREFIX'), '/opt/homebrew/opt/mingw-w64/toolchain-i686', '/usr/local/opt/mingw-w64/toolchain-i686'):
        if root and os.path.isdir(os.path.join(root, TARGET, 'include')):
            return os.path.join(root, TARGET, 'include')
    raise SystemExit('MinGW headers not found: brew install mingw-w64 (or set MINGW_PREFIX to the toolchain-i686 dir)')


def clang_base():
    clang = shutil.which('clang') or 'clang'
    res = subprocess.run([clang, '--print-resource-dir'], capture_output=True, text=True).stdout.strip()
    return [clang, '--target=' + TARGET, '-nostdinc', '-isystem', os.path.join(res, 'include'), '-isystem', mingw_include()]


def msvc_env():
    bat = os.path.join(tempfile.gettempdir(), 'tm_vcvars_env.bat')
    with open(bat, 'w') as f:
        f.write('@echo off\r\ncall "' + VCVARS + '" > nul\r\nset\r\n')
    out = subprocess.run(['cmd', '/c', bat], capture_output=True, text=True).stdout
    env = {}
    for line in out.splitlines():
        if '=' in line:
            k, v = line.split('=', 1)
            env[k] = v
    return env


def cl_path(env):
    return shutil.which('cl', path=env.get('PATH') or env.get('Path')) or 'cl'


def get_env():
    return msvc_env() if IS_WINDOWS else None


ARM64_TARGET = 'arm64-apple-macos'
ARM64_FLAGS = ['-x', 'c', '-std=gnu99', '-fms-extensions', '-fshort-wchar', '-ferror-limit=0', '-w'] + \
    [f for f in CLANG_FLAGS if f.startswith('-Wno-')]


def arm64_cmd(src, cwd, obj=None, extra=()):
    """Native Apple Silicon compile of one generated source: object code when `obj` is given, else syntax only.
    Pointers are 64-bit here, so the decompiler's `(T *)(int)` casts compile (the int-to-pointer warnings are off) but only
    mean something at run time with a 32-bit address space; this is the build-the-code milestone, not a runnable game."""
    out = ['-c', '-o', obj] if obj else ['-fsyntax-only']
    return ['clang', '--target=' + ARM64_TARGET] + ARM64_FLAGS + out + ['-I', cwd] + list(extra) + [src]


def check_cmd(src, cwd, env=None, extra=(), target=None):
    if target == 'arm64':
        return arm64_cmd(src, cwd, None, extra)
    if IS_WINDOWS:
        return ([cl_path(env), '/nologo', '/TC', '/Zs', '/W0', '/wd4244', '/wd4047', '/wd4024', '/wd4013', '/wd4133', '/wd4101',
                 '/Fo:NUL', src] + list(extra))
    return clang_base() + CLANG_FLAGS + ['-I', cwd] + list(extra) + [src]


def run_check(src, cwd, env=None, extra=(), target=None):
    r = subprocess.run(check_cmd(src, cwd, env, extra, target), capture_output=True, text=True, env=env, cwd=cwd)
    return r.stdout + r.stderr


def error_code(msg):
    """clang has no error numbers: use the -W flag if present, else a slug of the message with quoted names removed."""
    m = re.search(r'\[-W([\w-]+)\]\s*$', msg)
    if m:
        return m.group(1)
    slug = re.sub(r"'[^']*'", '', msg)
    slug = re.sub(r'[^a-z ]', '', slug.lower()).strip()
    return '_'.join(slug.split()[:6]) or 'error'


def parse_errors(text):
    for line in text.splitlines():
        line = line.strip()
        m = MSVC_ERR.match(line)
        if m:
            yield m.group('file'), int(m.group('line')), m.group('kind'), m.group('code'), m.group('msg')
            continue
        m = CLANG_ERR.match(line)
        if m:
            yield m.group('file'), int(m.group('line')), m.group('kind'), error_code(m.group('msg')), m.group('msg')


def undeclared_name(msg):
    m = re.search(r"'([^']+)'\s*:\s*undeclared identifier", msg) or re.search(r"use of undeclared identifier '([^']+)'", msg)
    return m.group(1) if m else None


def header_words(shim_dir):
    """All identifiers present in the preprocessed shim (so in windows.h / CRT headers): any Ghidra type name in this set
    is already defined and must not be re-declared as an incomplete struct."""
    probe = os.path.join(tempfile.gettempdir(), 'tm_shim_probe.c')
    with open(probe, 'w') as f:
        f.write('#include "ghidra_shim.h"\n')
    if IS_WINDOWS:
        env = msvc_env()
        r = subprocess.run([cl_path(env), '/nologo', '/TC', '/E', '/I', shim_dir, probe], capture_output=True, text=True, env=env)
    else:
        r = subprocess.run(clang_base() + ['-E', '-x', 'c', '-w', '-I', shim_dir, probe], capture_output=True, text=True)
    return set(re.findall(r'[A-Za-z_][A-Za-z0-9_]*', r.stdout))
