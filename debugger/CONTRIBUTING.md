# Contributing

## Firewall: what may be committed
Never commit game binaries, assets or anything else extracted from the game's files,
Ghidra databases, decompiler output (function bodies, listings), or logs and saves
from the running game. Run `python tools/audit_firewall.py` before every commit.
The `.gitignore` is a safety net, not a substitute for checking.

Facts about the binary (addresses, sizes), identifiers (function, class and
config-key names, recovered or made up), numbers and formulas in our own words,
and short strings quoted as evidence for a name may be committed. Another project's
output goes in only if its license allows it, with its source and license in
the root `THIRD_PARTY_NOTICES.md`. The one exception to the no-saves rule is the
two StarMaker stars made for testing, kept as hex fixtures in
`web/tests/sim/characterFixtures.ts`.

## Evidence for names and types
Every function name, struct, field or enum added must have recorded evidence
(RTTI, string xref, runtime trace, caller analysis...) in `docs/` or a code comment.
Don't commit guesses as facts; mark uncertain items clearly.

## Reproducibility
Extraction/generation must be a script that runs against the contributor's own
copy of the game. Document the command in the README.

## AI-assisted work
AI tools may assist, but a person reviews and owns every change, writes
outward-facing text (issues, PRs), and no automated traffic is sent to
community infrastructure.
