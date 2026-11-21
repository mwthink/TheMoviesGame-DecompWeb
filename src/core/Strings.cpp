#include "core/Strings.hpp"

#include <cctype>
#include <cerrno>
#include <cstdlib>

namespace otm::core {

std::string_view Trim(std::string_view s) {
    size_t b = 0, e = s.size();
    while (b < e && std::isspace(static_cast<unsigned char>(s[b]))) ++b;
    while (e > b && std::isspace(static_cast<unsigned char>(s[e - 1]))) --e;
    return s.substr(b, e - b);
}

std::string ToLower(std::string_view s) {
    std::string out(s);
    for (char& c : out) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return out;
}

bool EqualsNoCase(std::string_view a, std::string_view b) {
    if (a.size() != b.size()) return false;
    for (size_t i = 0; i < a.size(); ++i) {
        if (std::tolower(static_cast<unsigned char>(a[i])) != std::tolower(static_cast<unsigned char>(b[i]))) return false;
    }
    return true;
}

std::vector<std::string_view> Split(std::string_view s, char separator) {
    std::vector<std::string_view> parts;
    size_t start = 0;
    for (;;) {
        const size_t at = s.find(separator, start);
        if (at == std::string_view::npos) {
            parts.push_back(s.substr(start));
            return parts;
        }
        parts.push_back(s.substr(start, at - start));
        start = at + 1;
    }
}

std::optional<double> ParseDouble(std::string_view s) {
    s = Trim(s);
    if (s.empty()) return std::nullopt;
    const std::string text(s);  // strtod needs a terminated string
    char* end = nullptr;
    errno = 0;
    const double v = std::strtod(text.c_str(), &end);
    if (end != text.c_str() + text.size() || errno == ERANGE) return std::nullopt;
    return v;
}

std::optional<long long> ParseInt(std::string_view s) {
    s = Trim(s);
    if (s.empty()) return std::nullopt;
    const std::string text(s);
    char* end = nullptr;
    errno = 0;
    const long long v = std::strtoll(text.c_str(), &end, 10);
    if (end != text.c_str() + text.size() || errno == ERANGE) return std::nullopt;
    return v;
}

}  // namespace otm::core
