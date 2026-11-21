#include "core/Ini.hpp"

#include "core/File.hpp"
#include "core/Strings.hpp"

namespace otm::core {

IniFile::Section* IniFile::Find(std::string_view lowerName) {
    for (Section& s : sections_) {
        if (s.name == lowerName) return &s;
    }
    return nullptr;
}

const IniFile::Section* IniFile::Find(std::string_view name) const {
    for (const Section& s : sections_) {
        if (EqualsNoCase(s.name, name)) return &s;
    }
    return nullptr;
}

IniFile IniFile::Parse(std::string_view text) {
    IniFile ini;
    if (text.size() >= 3 && text.substr(0, 3) == "\xEF\xBB\xBF") text.remove_prefix(3);  // UTF-8 byte order mark
    std::string current;  // lower-cased name of the current section
    bool started = false;  // the "" section only exists if a key shows up before the first [section]
    size_t pos = 0;
    while (pos <= text.size()) {
        size_t eol = text.find('\n', pos);
        if (eol == std::string_view::npos) eol = text.size();
        std::string_view line = Trim(text.substr(pos, eol - pos));  // Trim also removes the '\r' of CRLF files
        pos = eol + 1;
        if (line.empty() || line[0] == '#') continue;
        if (line.front() == '[') {
            const size_t close = line.find(']');
            if (close == std::string_view::npos) continue;
            current = ToLower(Trim(line.substr(1, close - 1)));
            started = true;
            if (!ini.Find(current)) ini.sections_.push_back({current, {}, {}});
            continue;
        }
        if (!started) {
            started = true;
            if (!ini.Find("")) ini.sections_.push_back({"", {}, {}});
        }
        Section* section = ini.Find(current);
        const size_t eq = line.find('=');
        if (eq == std::string_view::npos) {
            section->bare.emplace_back(line);
            continue;
        }
        std::string_view value = Trim(line.substr(eq + 1));
        if (!value.empty() && value.back() == ';') value = Trim(value.substr(0, value.size() - 1));
        const std::string key = ToLower(Trim(line.substr(0, eq)));
        bool replaced = false;
        for (auto& kv : section->entries) {
            if (kv.first == key) {
                kv.second = std::string(value);  // the last duplicate wins
                replaced = true;
                break;
            }
        }
        if (!replaced) section->entries.emplace_back(key, std::string(value));
    }
    return ini;
}

bool IniFile::Load(const std::string& path, IniFile& out) {
    std::string text;
    if (!ReadFile(path, text)) return false;
    out = Parse(text);
    return true;
}

bool IniFile::HasSection(std::string_view section) const { return Find(section) != nullptr; }

bool IniFile::Has(std::string_view section, std::string_view key) const { return GetString(section, key).has_value(); }

std::optional<std::string> IniFile::GetString(std::string_view section, std::string_view key) const {
    const Section* s = Find(section);
    if (!s) return std::nullopt;
    for (const auto& kv : s->entries) {
        if (EqualsNoCase(kv.first, key)) return kv.second;
    }
    return std::nullopt;
}

std::optional<double> IniFile::GetDouble(std::string_view section, std::string_view key) const {
    const auto v = GetString(section, key);
    return v ? ParseDouble(*v) : std::nullopt;
}

std::optional<long long> IniFile::GetInt(std::string_view section, std::string_view key) const {
    const auto v = GetString(section, key);
    return v ? ParseInt(*v) : std::nullopt;
}

std::vector<std::string> IniFile::SectionNames() const {
    std::vector<std::string> names;
    for (const Section& s : sections_) names.push_back(s.name);
    return names;
}

std::vector<std::pair<std::string, std::string>> IniFile::Entries(std::string_view section) const {
    const Section* s = Find(section);
    return s ? s->entries : std::vector<std::pair<std::string, std::string>>{};
}

std::vector<std::string> IniFile::BareLines(std::string_view section) const {
    const Section* s = Find(section);
    return s ? s->bare : std::vector<std::string>{};
}

}  // namespace otm::core
