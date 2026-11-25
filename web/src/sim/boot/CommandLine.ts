// The game's command-line switches.
//
// From CmdLine_GetSwitch (0x00567860, finds "-key [value]"), Game_ParseCommandLine (0x00421A70: -reenter, -editor, -download <value>, called from
// Game_Constructor 0x004291C0) and WinMain (0x00542B20: -safemode, the call at 0x00543072). All four callers pass WinMain's lpCmdLine (the command line
// without the program name). Derivation and the quirks below: docs/BOOT.md. Read from the decompile and its disassembly; not run against the binary.

export interface SwitchResult {
  found: boolean;
  /** the token after the key, or empty; meaningful only when found */
  value: string;
}

/**
 * Scans character by character, with the original's quirks:
 * - quirk: a '-' starts a switch anywhere, even inside a word ("a-reenter" contains "reenter");
 * - spaces after the '-' are skipped ("- reenter" works), then the key runs to the next space or the end;
 * - the key is compared exactly and case-sensitively ("-Reenter" is not "reenter", "-reenterx" is not "reenter");
 * - quirk: the value is the next space-delimited token after the key, even if it starts with '-' ("-download -editor" gives download the value
 *   "-editor"), cut at maxValueLen characters;
 * - every occurrence is scanned: found stays true and the last match's value wins (a later match with no value gives "").
 * The original keeps the key in a 1024-byte buffer without a length check and writes the value's terminator one past a maxValueLen-byte buffer; neither
 * is reproduced. orig: 0x00567860
 */
export function getSwitch(commandLine: string, key: string, maxValueLen = 100): SwitchResult {
  const nul = commandLine.indexOf("\0"); // the original reads a C string: an embedded NUL ends it
  if (nul >= 0) commandLine = commandLine.slice(0, nul);
  const at = (i: number) => (i < commandLine.length ? commandLine[i]! : "\0");
  const result: SwitchResult = { found: false, value: "" };
  let p = 0;
  for (;;) {
    const c = at(p);
    if (c === "\0") return result;
    if (c !== "-") {
      p++;
      continue;
    }
    p++; // past the '-'
    while (at(p) === " ") p++; // spaces after it are skipped
    let token = "";
    while (at(p) !== "\0" && at(p) !== " ") token += at(p++);
    if (token !== key) continue; // p is at the terminator (space or end)
    while (at(p) === " ") p++;
    let value = "";
    let budget = maxValueLen;
    while (at(p) !== "\0" && at(p) !== " " && budget > 0) {
      value += at(p++);
      budget--;
    }
    result.found = true;
    result.value = value; // a later match overwrites an earlier one
  }
}

export interface LaunchOptions {
  /** WinMain: -safemode forces an 800x600 window */
  safeMode: boolean;
  /** Game +0x84: -reenter */
  reenter: boolean;
  /** Game +0x85: -editor (makes Game_StartupSequence call FUN_007843B0) */
  editor: boolean;
  /** Game +0xC8: -download (opens the front end with flag 1, then FUN_0068F550) */
  download: boolean;
  /** DAT_00E57B40, set only when -download is present */
  downloadValue: string;
}

/** WinMain (safemode) and Game_ParseCommandLine. maxValueLen is 100 in both, as in the original. orig: 0x00421A70 */
export function parseLaunchOptions(commandLine: string): LaunchOptions {
  const download = getSwitch(commandLine, "download");
  return {
    safeMode: getSwitch(commandLine, "safemode").found,
    reenter: getSwitch(commandLine, "reenter").found,
    editor: getSwitch(commandLine, "editor").found,
    download: download.found,
    downloadValue: download.found ? download.value : "",
  };
}
