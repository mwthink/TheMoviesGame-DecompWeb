// Checks the command-line parser against what its decompile and disassembly say (CmdLine_GetSwitch 0x00567860). Not compared
// with the running game: the quirks below come from reading the code, so they are only as good as that reading.
#include <cstdio>
#include <string>

#include "game/boot/CommandLine.hpp"

using namespace otm::boot;

static int g_failures = 0;
static void Check(const char* what, bool ok) {
    if (!ok) { std::printf("FAIL %s\n", what); ++g_failures; }
}
static bool Is(const SwitchResult& r, bool found, const char* value) { return r.found == found && (!found || r.value == value); }

int main() {
    Check("empty command line", Is(GetSwitch("", "reenter"), false, ""));
    Check("plain switch", Is(GetSwitch("-reenter", "reenter"), true, ""));
    Check("switch with a value", Is(GetSwitch("-download movie.mov", "download"), true, "movie.mov"));
    Check("value stops at a space", Is(GetSwitch("-download a b", "download"), true, "a"));
    Check("extra spaces before the value", Is(GetSwitch("-download    spaced", "download"), true, "spaced"));
    Check("key is not a prefix match", Is(GetSwitch("-reenterx", "reenter"), false, ""));
    Check("key is not a suffix match", Is(GetSwitch("-xreenter", "reenter"), false, ""));
    Check("case sensitive", Is(GetSwitch("-Reenter", "reenter"), false, ""));
    Check("no dash, no switch", Is(GetSwitch("reenter", "reenter"), false, ""));
    Check("spaces after the dash are skipped", Is(GetSwitch("-   reenter", "reenter"), true, ""));
    Check("a dash inside a word starts a switch", Is(GetSwitch("a-reenter", "reenter"), true, ""));
    Check("found anywhere in the line", Is(GetSwitch("-editor -download x -reenter", "reenter"), true, ""));
    Check("a trailing dash is the value of the switch before it", Is(GetSwitch("-reenter -", "reenter"), true, "-"));
    Check("... but still not a switch of its own", Is(GetSwitch("-reenter -", "editor"), false, ""));
    Check("lone dash", Is(GetSwitch("-", "reenter"), false, ""));

    // The value is the next token even if it looks like a switch, but each call scans from the start on its own.
    Check("value may start with a dash", Is(GetSwitch("-download -editor", "download"), true, "-editor"));
    Check("the consumed token is still found by its own call", Is(GetSwitch("-download -editor", "editor"), true, ""));

    // Several matches: found stays true, the last value wins, and a later match without a value clears it.
    Check("last value wins", Is(GetSwitch("-download a -download b", "download"), true, "b"));
    Check("later match without a value clears it", Is(GetSwitch("-download a -download", "download"), true, ""));
    Check("a mismatch does not clear it", Is(GetSwitch("-download a -other", "download"), true, "a"));

    // The value is capped (100 in the game), cut mid-token; the rest is scanned as ordinary characters.
    const std::string longValue(150, 'x');
    Check("value capped at 100", Is(GetSwitch("-download " + longValue, "download"), true, std::string(100, 'x').c_str()));
    Check("cap is a parameter", Is(GetSwitch("-download abcdef", "download", 3), true, "abc"));
    Check("a cut-off value keeps the rest for scanning", Is(GetSwitch("-download abc-reenter", "download", 3), true, "abc"));
    Check("... and the rest can itself be a switch", Is(GetSwitch("-download abcdef-reenter", "reenter", 3), true, ""));
    Check("an embedded NUL ends the line", Is(GetSwitch(std::string_view("-reenter\0-editor", 16), "editor"), false, ""));

    // The four switches the game reads.
    {
        const LaunchOptions o = ParseLaunchOptions("");
        Check("defaults", !o.safeMode && !o.reenter && !o.editor && !o.download && o.downloadValue.empty());
    }
    {
        const LaunchOptions o = ParseLaunchOptions("-safemode -reenter");
        Check("safemode and reenter", o.safeMode && o.reenter && !o.editor && !o.download);
    }
    {
        const LaunchOptions o = ParseLaunchOptions("-editor -download saved.tmm");
        Check("editor and download", o.editor && o.download && o.downloadValue == "saved.tmm" && !o.reenter);
    }
    {
        const LaunchOptions o = ParseLaunchOptions("-download");
        Check("download without a value is still download", o.download && o.downloadValue.empty());
    }
    {
        const LaunchOptions o = ParseLaunchOptions("-download -editor");
        Check("download swallows the next token but editor is still seen", o.download && o.downloadValue == "-editor" && o.editor);
    }

    if (g_failures == 0) std::printf("command_line_test: OK\n");
    return g_failures == 0 ? 0 : 1;
}
