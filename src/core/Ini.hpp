// Reader for the game's .ini files (Data\releasing_movies.ini, stunts.ini, global.ini, ...).
//
// The files use:  [section]  /  key = value  /  # full-line comments. CRLF or LF, a trailing ';' on a value is dropped
// (global.ini has "DebutAwardRotateInterval = 6000;"). Section and key names are case-insensitive. Keys before the first
// [section] belong to the section "" (experience.ini, awardsbonuses.ini, the top of stunts.ini). Lines without '=' are kept
// as "bare lines" of their section (ranking.ini lists achievement names that way). A section that appears twice is merged;
// when a key repeats, the last one wins.
#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace otm::core {

class IniFile {
public:
    static IniFile Parse(std::string_view text);
    // false if the file cannot be read
    static bool Load(const std::string& path, IniFile& out);

    bool HasSection(std::string_view section) const;
    bool Has(std::string_view section, std::string_view key) const;
    std::optional<std::string> GetString(std::string_view section, std::string_view key) const;
    std::optional<double> GetDouble(std::string_view section, std::string_view key) const;
    std::optional<long long> GetInt(std::string_view section, std::string_view key) const;

    // Section names in order of first appearance, lower-cased ("" for keys before any section when there are any).
    std::vector<std::string> SectionNames() const;
    // key / value pairs of a section in file order (keys lower-cased).
    std::vector<std::pair<std::string, std::string>> Entries(std::string_view section) const;
    // lines without '=' in file order
    std::vector<std::string> BareLines(std::string_view section) const;

private:
    struct Section {
        std::string name;  // lower-cased
        std::vector<std::pair<std::string, std::string>> entries;
        std::vector<std::string> bare;
    };
    Section* Find(std::string_view lowerName);
    const Section* Find(std::string_view name) const;
    std::vector<Section> sections_;
};

}  // namespace otm::core
