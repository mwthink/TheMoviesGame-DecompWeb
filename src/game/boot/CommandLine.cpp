#include "game/boot/CommandLine.hpp"

namespace otm::boot {

// orig: CmdLine_GetSwitch 0x00567860
SwitchResult GetSwitch(std::string_view commandLine, std::string_view key, std::size_t maxValueLen) {
    // The original reads a C string: an embedded NUL ends it.
    const std::size_t nul = commandLine.find('\0');
    if (nul != std::string_view::npos) commandLine = commandLine.substr(0, nul);
    const auto at = [&](std::size_t i) -> char { return i < commandLine.size() ? commandLine[i] : '\0'; };

    SwitchResult result;
    std::size_t p = 0;
    for (;;) {
        const char c = at(p);
        if (c == '\0') return result;
        if (c != '-') { ++p; continue; }

        ++p;                                           // past the '-'
        while (at(p) == ' ') ++p;                      // spaces after it are skipped
        std::string token;
        while (at(p) != '\0' && at(p) != ' ') token.push_back(at(p++));
        if (token != key) continue;                    // p is at the terminator (space or end)

        while (at(p) == ' ') ++p;
        std::string value;
        std::size_t budget = maxValueLen;
        while (at(p) != '\0' && at(p) != ' ' && budget > 0) { value.push_back(at(p++)); --budget; }
        result.found = true;
        result.value = std::move(value);               // a later match overwrites an earlier one
    }
}

LaunchOptions ParseLaunchOptions(std::string_view commandLine) {
    LaunchOptions o;
    o.safeMode = GetSwitch(commandLine, "safemode").found;
    o.reenter = GetSwitch(commandLine, "reenter").found;
    o.editor = GetSwitch(commandLine, "editor").found;
    const SwitchResult download = GetSwitch(commandLine, "download");
    if (download.found) {
        o.download = true;
        o.downloadValue = download.value;
    }
    return o;
}

}  // namespace otm::boot
