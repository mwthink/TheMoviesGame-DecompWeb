// Small string helpers shared by the file parsers. These are new helpers for the reimplementation, not ports of the game's
// own string classes (MV:: / LH:: / PKStrings, which are decompiled elsewhere).
#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace otm::core {

std::string_view Trim(std::string_view s);
std::string ToLower(std::string_view s);
bool EqualsNoCase(std::string_view a, std::string_view b);
std::vector<std::string_view> Split(std::string_view s, char separator);

// The whole string (after trimming) must be a number; "1.5", "-0.4", "1e-5", "70000" are accepted, "", "abc", "1.5x" are not.
std::optional<double> ParseDouble(std::string_view s);
std::optional<long long> ParseInt(std::string_view s);

}  // namespace otm::core
