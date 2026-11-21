// Tests for the core/ parsers on small inline samples (no game files needed).
#include <cmath>
#include <cstdio>

#include "core/Csv.hpp"
#include "core/Ini.hpp"
#include "core/Strings.hpp"

using namespace otm::core;

static int g_failures = 0;

#define CHECK(cond)                                                    \
    do {                                                               \
        if (!(cond)) {                                                 \
            std::printf("FAIL line %d: %s\n", __LINE__, #cond);        \
            ++g_failures;                                              \
        }                                                              \
    } while (0)

int main() {
    // ---- strings ----
    CHECK(Trim("  a b \t\r\n") == "a b");
    CHECK(Trim("") == "");
    CHECK(ToLower("MiXed_09") == "mixed_09");
    CHECK(EqualsNoCase("Star_Mood", "STAR_mood"));
    CHECK(!EqualsNoCase("a", "ab"));
    CHECK(Split("a,b,,c", ',').size() == 4);
    CHECK(Split("", ',').size() == 1);
    CHECK(ParseDouble(" 1.5 ").value() == 1.5);
    CHECK(ParseDouble("-0.4").value() == -0.4);
    CHECK(ParseDouble("1e-5").value() == 1e-5);
    CHECK(ParseDouble("70000").value() == 70000.0);
    CHECK(!ParseDouble("").has_value());
    CHECK(!ParseDouble("abc").has_value());
    CHECK(!ParseDouble("1.5x").has_value());
    CHECK(ParseInt("42").value() == 42);
    CHECK(!ParseInt("4.2").has_value());

    // ---- ini ----
    {
        const char* text =
            "\xEF\xBB\xBF# comment\r\n"
            "top = 1\r\n"
            "\r\n"
            "[Min_Max]\r\n"
            "\tstar_mood_min = 0.8\r\n"
            "      indented_key = 2\r\n"
            "STAR_MOOD_MAX=1.2\r\n"
            "\r\n"
            "[global]\n"
            "DebutAwardRotateInterval = 6000;\n"
            "name = some text with spaces  \n"
            "empty =\n"
            "dup = 1\n"
            "dup = 2\n"
            "[min_max]\n"
            "extra = 7\n"
            "[ranking]\n"
            "ACHIEVEMENT_ONE\n"
            "ACHIEVEMENT_TWO\n"
            "# another comment\n";
        const IniFile ini = IniFile::Parse(text);
        CHECK(ini.GetDouble("", "top").value() == 1.0);             // keys before the first section
        CHECK(ini.GetDouble("min_max", "star_mood_min").value() == 0.8);
        CHECK(ini.GetDouble("MIN_MAX", "Star_Mood_Max").value() == 1.2);  // names are case-insensitive
        CHECK(ini.GetInt("min_max", "indented_key").value() == 2);
        CHECK(ini.GetInt("min_max", "extra").value() == 7);          // a repeated section is merged
        CHECK(ini.GetInt("global", "debutawardrotateinterval").value() == 6000);  // trailing ';' dropped
        CHECK(ini.GetString("global", "name").value() == "some text with spaces");
        CHECK(ini.GetString("global", "empty").value() == "");
        CHECK(!ini.GetDouble("global", "empty").has_value());        // empty is not a number
        CHECK(ini.GetInt("global", "dup").value() == 2);             // the last duplicate wins
        CHECK(!ini.Has("global", "missing"));
        CHECK(!ini.HasSection("nope"));
        CHECK(!ini.GetString("nope", "x").has_value());
        CHECK(ini.BareLines("ranking").size() == 2);
        CHECK(ini.BareLines("ranking")[1] == "ACHIEVEMENT_TWO");
        const auto names = ini.SectionNames();
        CHECK(names.size() == 4 && names[0].empty() && names[1] == "min_max" && names[3] == "ranking");
        CHECK(ini.Entries("min_max").size() == 4);
        CHECK(ini.Entries("min_max")[0].first == "star_mood_min");   // file order, lower-cased keys
        CHECK(!IniFile::Parse("[only]\nk = 1\n").HasSection(""));     // no "" section when nothing precedes the first one
        CHECK(IniFile::Parse("").SectionNames().empty());
        IniFile missing;
        CHECK(!IniFile::Load("/definitely/not/a/file.ini", missing));
    }

    // ---- csv ----
    {
        const auto rows = ParseCsv("[constants],,,\r\nhalflife,4,,\r\n\r\n\"a,b\",\"say \"\"hi\"\"\",x\r\nlast,row");
        CHECK(rows.size() == 5);
        CHECK(rows[0].size() == 4 && rows[0][0] == "[constants]" && rows[0][3].empty());
        CHECK(rows[1][0] == "halflife" && rows[1][1] == "4");
        CHECK(rows[2].empty());                                       // blank line keeps the row numbers
        CHECK(rows[3].size() == 3 && rows[3][0] == "a,b" && rows[3][1] == "say \"hi\"");
        CHECK(rows[4].size() == 2 && rows[4][1] == "row");            // no trailing newline
        CHECK(ParseCsv("").empty());
        CHECK(ParseCsv("a,\n")[0].size() == 2);                       // trailing comma = empty last field
    }

    if (g_failures) {
        std::printf("%d check(s) failed\n", g_failures);
        return 1;
    }
    std::printf("all core checks passed\n");
    return 0;
}
