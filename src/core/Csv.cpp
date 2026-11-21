#include "core/Csv.hpp"

#include "core/File.hpp"

namespace otm::core {

std::vector<CsvRow> ParseCsv(std::string_view text) {
    if (text.size() >= 3 && text.substr(0, 3) == "\xEF\xBB\xBF") text.remove_prefix(3);
    std::vector<CsvRow> rows;
    CsvRow row;
    std::string field;
    bool quoted = false;
    bool any = false;  // something was read on this line
    auto endField = [&] {
        row.push_back(field);
        field.clear();
    };
    auto endRow = [&] {
        if (any) endField();
        rows.push_back(row);
        row.clear();
        any = false;
    };
    for (size_t i = 0; i < text.size(); ++i) {
        const char c = text[i];
        if (quoted) {
            if (c == '"') {
                if (i + 1 < text.size() && text[i + 1] == '"') {
                    field += '"';
                    ++i;
                } else {
                    quoted = false;
                }
            } else {
                field += c;
            }
            continue;
        }
        if (c == '"') {
            quoted = true;
            any = true;
        } else if (c == ',') {
            endField();
            any = true;
        } else if (c == '\r') {
            // ignored: the '\n' ends the line (a lone '\r' does not)
        } else if (c == '\n') {
            endRow();
        } else {
            field += c;
            any = true;
        }
    }
    if (any) endRow();
    return rows;
}

bool LoadCsv(const std::string& path, std::vector<CsvRow>& out) {
    std::string text;
    if (!ReadFile(path, text)) return false;
    out = ParseCsv(text);
    return true;
}

}  // namespace otm::core
