"""Fail if files about to be committed look like game-derived material or machine-specific data.

Usage: python3 tools/audit_firewall.py [--all]
  default: the staged (index) version of every tracked file, plus the working copy where it differs, plus untracked files
           that are not ignored. This is what the next commit can contain.
  --all:   every file in the work tree, ignored ones included (except .git and node_modules); expect failures under data/.

Checks (the rule is in CLAUDE.md, "Always"):
  - paths under the local-only folders (data/, gen/, docs/generated/, viewer/data/, Ghidra projects)
  - forbidden extensions, and binary content of any kind (a NUL byte in the first 8 KB)
  - files larger than 2 MB
  - decompiler output: a Ghidra FUN_ signature, or a run of lines using Ghidra's generated variable names
  - embedded data: long hex byte runs (also across lines), long hex strings, long base64 strings
  - machine paths: home folders and the values set in local.env
"""
import os, re, subprocess, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SELF = "tools/audit_firewall.py"

LOCAL_ONLY = ("data/", "gen/", "docs/generated/", "viewer/data/", "Commons/")
BAD_EXT = {".exe", ".dll", ".pdb", ".obj", ".lib", ".bin", ".flm", ".gpr", ".gzf", ".whl"}
MAX_BYTES = 2_000_000
SKIP_DIRS = {".git", "node_modules"}
# Checks a file may skip, with the reason (keep in step with CLAUDE.md, "Always").
ALLOW = {
    "web/tests/sim/characterFixtures.ts": {"long hex string"},  # the two test stars' info.sm files, saved in StarMaker
}

# A Ghidra function header: some type words, then FUN_xxxxxxxx( ... ), then optionally "{".
FUN_SIGNATURE = re.compile(r"^[ \t]*(?:[\w]+[ \t\*]+)+FUN_[0-9a-fA-F]{8}[ \t]*\([^;\n]*\)[ \t]*\{?[ \t]*$", re.M)
# A statement using Ghidra's generated names (iVar1, uVar2, local_14, param_1, in_EAX, unaff_ESI, extraout_ECX, ...).
GHIDRA_LINE = re.compile(r"\b(?:[a-z]{1,4}Var\d+|local_[0-9a-f]+|param_\d+|in_[A-Z]{2,3}|unaff_\w+|extraout_\w+)\b.*;\s*$")
GHIDRA_RUN = 5  # this many such lines in a row is a pasted function body
# 32+ two-digit hex bytes separated by spaces, commas or line breaks; at least one must be 0x-prefixed or contain a-f,
# so a table of decimal numbers does not count.
HEX_RUN = re.compile(r"(?:(?<![\w.])(?:0x)?[0-9a-fA-F]{2}(?![\w.])[ \t,]*(?:\r?\n[ \t]*)?){32,}")
HEX_STRING = re.compile(r"\b[0-9a-fA-F]{128,}\b")
BASE64 = re.compile(r"[A-Za-z0-9+/]{200,}={0,2}")
HOME_PATH = re.compile(r"(?:/Users/|/home/|[A-Za-z]:\\+Users\\+)(?!Shared\b)[A-Za-z0-9._-]+[/\\]")


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, check=True).stdout


def local_env_values():
    """Values set in local.env: this machine's paths, which must not appear in committed files."""
    p = ROOT / "local.env"
    vals = set()
    if p.is_file():
        for line in p.read_text(errors="ignore").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                v = line.split("=", 1)[1].strip().strip("'\"")
                if len(v) >= 8:
                    vals.add(v)
                    vals.add(os.path.expanduser(v))
    return vals


def candidates(all_):
    """(path, label, bytes) for everything to check."""
    if all_:
        for dirpath, dirs, names in os.walk(ROOT):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for n in names:
                p = pathlib.Path(dirpath) / n
                if p.is_file():
                    yield p.relative_to(ROOT).as_posix(), "", p.read_bytes()
        return
    # Staged blobs: "mode sha stage\tpath" NUL-separated; -z keeps non-ASCII paths unquoted.
    staged = []
    for rec in git("ls-files", "-z", "-s").split(b"\0"):
        if rec:
            meta, path = rec.split(b"\t", 1)
            mode, sha = meta.split()[:2]
            if mode != b"160000":  # submodule
                staged.append((path.decode("utf-8", "surrogateescape"), sha.decode()))
    blobs = {}
    if staged:
        out = subprocess.run(["git", "cat-file", "--batch"], cwd=ROOT, capture_output=True, check=True,
                             input=b"".join(s.encode() + b"\n" for _, s in staged)).stdout
        i = 0
        for _, sha in staged:
            nl = out.index(b"\n", i)
            size = int(out[i:nl].split()[2])
            blobs[sha] = out[nl + 1:nl + 1 + size]
            i = nl + 1 + size + 1
    for path, sha in staged:
        data = blobs[sha]
        yield path, "", data
        disk = ROOT / path
        if disk.is_file() and not disk.is_symlink():
            d = disk.read_bytes()
            if d != data:
                yield path, " (working copy)", d
    for rec in git("ls-files", "-z", "-o", "--exclude-standard").split(b"\0"):
        if rec:
            path = rec.decode("utf-8", "surrogateescape")
            p = ROOT / path
            if p.is_file():
                yield path, " (untracked)", p.read_bytes()


def check(path, data, env_vals):
    errs = []
    if path.startswith(LOCAL_ONLY) or any(part.endswith(".rep") for part in path.split("/")[:-1]):
        errs.append("path is in a local-only folder")
    if pathlib.PurePosixPath(path).suffix.lower() in BAD_EXT:
        errs.append("forbidden extension")
    if len(data) > MAX_BYTES:
        errs.append("file larger than 2 MB")
    if b"\0" in data[:8192]:
        errs.append("binary file")
        return errs
    if path == SELF:
        return errs
    t = data.decode("utf-8", errors="ignore")
    if FUN_SIGNATURE.search(t):
        errs.append("Ghidra FUN_ function signature")
    run = 0
    for line in t.splitlines():
        run = run + 1 if GHIDRA_LINE.search(line) else 0
        if run >= GHIDRA_RUN:
            errs.append(f"{GHIDRA_RUN}+ lines in a row using Ghidra variable names (decompiler output)")
            break
    for m in HEX_RUN.finditer(t):
        s = m.group(0)
        if "0x" in s or re.search(r"[a-fA-F]", s):
            errs.append("long hex byte run")
            break
    if HEX_STRING.search(t):
        errs.append("long hex string")
    if any(not re.fullmatch(r"[0-9a-fA-F]+", m.group(0).rstrip("=")) for m in BASE64.finditer(t)):
        errs.append("long base64 string")
    m = HOME_PATH.search(t)
    if m:
        errs.append(f"machine path ({m.group(0)}...)")
    for v in env_vals:
        if v in t:
            errs.append("contains a value from local.env")
            break
    return errs


def main():
    bad = 0
    env_vals = local_env_values()
    for path, label, data in candidates("--all" in sys.argv):
        for e in check(path, data, env_vals):
            if e in ALLOW.get(path, ()):
                continue
            print(f"FAIL {path}{label}: {e}")
            bad += 1
    print("audit failed" if bad else "audit passed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
