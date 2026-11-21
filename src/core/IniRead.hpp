#pragma once

#include <string>
#include <vector>

#include "core/Ini.hpp"

namespace otm::core {

// Reads a float setting into dst. If the key is missing or not a number, dst keeps its value and a line
// "file [section] key: missing" / "not a number" is appended to problems.
inline void ReadFloat(const IniFile& ini, const char* file, const char* section, const char* key, float& dst,
                      std::vector<std::string>& problems) {
    const auto v = ini.GetDouble(section, key);
    if (!v) {
        problems.push_back(std::string(file) + " [" + section + "] " + key + ": " + (ini.Has(section, key) ? "not a number" : "missing"));
        return;
    }
    dst = static_cast<float>(*v);
}

}  // namespace otm::core
