// The game's command-line switches.
//
// Reimplemented from:
//   CmdLine_GetSwitch       0x00567860  finds "-key [value]" in a command line
//   Game_ParseCommandLine   0x00421A70  -reenter, -editor, -download <value>   (called from Game_Constructor 0x004291C0)
//   WinMain                 0x00542B20  -safemode (call at 0x00543072)
// All four callers pass WinMain's lpCmdLine (the command line without the program name). Derivation and the quirks below:
// docs/BOOT.md. The parser was read from the decompile and its disassembly; it has not been run against the real binary.
#pragma once

#include <cstddef>
#include <string>
#include <string_view>

namespace otm::boot {

struct SwitchResult {
    bool found = false;
    std::string value;   // the token after the key, or empty. Only meaningful when found.
};

// orig: CmdLine_GetSwitch 0x00567860 (verified by reading: not run)
//
// Scanning is character by character, so the quirks are the original's:
//  - a '-' starts a switch anywhere, even in the middle of a word ("a-reenter" contains "reenter");
//  - spaces after the '-' are skipped ("- reenter" works), then the key is the run up to the next space or the end;
//  - the key is compared exactly, case-sensitively ("-Reenter" is not "reenter", "-reenterx" is not "reenter");
//  - the value is the next space-delimited token after the key, even if it starts with '-'
//    ("-download -editor" gives download the value "-editor"), cut at maxValueLen characters;
//  - every occurrence is scanned: found stays true, and the value of the last match wins (a later match with no value gives "").
// The original keeps the key in a 1024-byte buffer without a length check and writes the value's terminator one past a
// maxValueLen-byte buffer; neither is reproduced.
SwitchResult GetSwitch(std::string_view commandLine, std::string_view key, std::size_t maxValueLen = 100);

struct LaunchOptions {
    bool safeMode = false;        // WinMain: -safemode forces an 800x600 window
    bool reenter = false;         // Game +0x84: -reenter
    bool editor = false;          // Game +0x85: -editor (makes Game_StartupSequence call FUN_007843B0)
    bool download = false;        // Game +0xC8: -download (opens the front end with flag 1, then FUN_0068F550)
    std::string downloadValue;    // DAT_00E57B40, set only when -download is present
};

// orig: WinMain (safemode) and Game_ParseCommandLine 0x00421A70. maxValueLen is 100 in both, as in the original.
LaunchOptions ParseLaunchOptions(std::string_view commandLine);

}  // namespace otm::boot
