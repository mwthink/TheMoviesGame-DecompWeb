# Working in this repository

Read `docs/STATUS.md` first (the goal, per-system state, next steps), then the document for the system you are touching. `docs/REIMPLEMENTATION.md`
has the rules for ported code (`orig:` tags, `verified`, `quirk:`, `Math.fround`).

## Always

- Run `python3 tools/audit_firewall.py` before every commit. No game files, extracted assets, decompiler output or game-derived names go into git;
  they live under `data/`, `docs/generated/`, `viewer/data/` (gitignored).
- Commit only when the user asks.
- Stay on current branch unless user says otherwise.
- Machine paths come from `local.env` (`local.env.example`), read by `web/localPaths.ts` and `tools/local_paths.py`. Never write a path from this
  machine, a save's file name or a star's name into code, tests or docs: refer to saves by what they are (`web/localPaths.ts`, `SAVE_ROLES`).

## Documents

- Docs describe the current state. Correct a wrong statement in place instead of adding a dated correction below it; history is in git. No session
  dates in headings.
- When a system's state changes (decoded, ported, verified), update its row in `docs/STATUS.md`.
- Evidence labels: **[code]** / **[read]** (seen in the decompile), **[data]** / **[config]** (game files), **[measured]** (logged from the running game),
  **[inferred]** / **[guess]**.

## The original game

- **Windows test box** (`docs/WINDOWS_TEST_BOX.md`): key login only, never a password. Do not change its security settings (SSH, firewall, Defender,
  auto-logon, RDP); the owner does that with `tools/winbox/setup_box.ps1`. Of a scripted sequence's screenshots, read only the last; open earlier ones only
  to work backwards from a wrong end state.
- **Ghidra**: copy a project (`cp -R`) before applying names, dry-run `ApplyNames.java` first, and check that a second dry run reports 0 changes.
  Keep `tools/ghidra_names.csv` and `renames.csv` current; they are the record of the naming work.

## The web app

- The desktop app's preview server (`.claude/launch.json`, entry `web`) cannot read files under `~/Documents` or the CrossOver bottle; its reads hang.
  For anything that loads game files, run `npm run dev` from a terminal instead.
- Keep `web/src/assets`, `web/src/formats`, `web/src/sim` and `web/src/world/WorldData.ts` free of browser and engine APIs (beyond `Blob`/`fetch`) so the
  tests run them in Node, and write erasable TypeScript there (no enums, no constructor parameter properties).
