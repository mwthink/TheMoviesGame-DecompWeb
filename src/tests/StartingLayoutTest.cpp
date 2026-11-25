// Checks the layout name and the layout-file parser against inline samples shaped like data\savedefaults\*.ini and data\lots\basic_lot.ini
// (read in docs/NEW_GAME.md). Not compared with the running game, and the real files are not needed.
#include <cstdio>

#include "game/sandbox/StartingLayout.hpp"

using namespace otm::sandbox;

static int g_failures = 0;
static void Check(const char* what, bool ok) {
    if (!ok) { std::printf("FAIL %s\n", what); ++g_failures; }
}

int main() {
    // --- The name Campaign_Begin builds.
    Check("new game 1960", StartingLayoutName(false, 1960, GameType::NewGame, true).name == "savedefaults/1960");
    Check("the empty-lot flag does not apply to a normal new game", !StartingLayoutName(false, 1960, GameType::NewGame, true).clearEmptyLotFlag);
    Check("tutorial", StartingLayoutName(true, 1960, GameType::Tutorial, false).name == "savedefaults/tutorial");
    Check("tutorial ignores the year", StartingLayoutName(true, 1990, GameType::Tutorial, true).name == "savedefaults/tutorial");
    {
        const LayoutName n = StartingLayoutName(false, 1960, GameType::Sandbox, true);
        Check("sandbox with the flag set is the clean (empty) lot", n.name == "savedefaults/1960_clean" && n.clearEmptyLotFlag);
    }
    Check("sandbox with the flag clear is the built lot", StartingLayoutName(false, 1960, GameType::Sandbox, false).name == "savedefaults/1960");
    Check("add-on quick start follows the same rule", StartingLayoutName(false, 1940, GameType::AddOnQuickStart, true).name == "savedefaults/1940_clean");
    Check("the year is printed as given", StartingLayoutName(false, 2000, GameType::NewGame, false).name == "savedefaults/2000");

    // --- A layout file.
    const char* sample =
        "\tsize = 2.00\n\n"
        "[1.00]\n\tname = facility/facility_preproduction\n\tposition = -31.38, 58.69\n\tangle = 0.00\n\n"
        "[2.00]\n\tname = facility/trailer_3\n\tposition = 81.34, 93.23\n\tangle = 1.57\n\n"
        "[3.00]\n\tname = ornament/bench\n\tposition = 5.5, -7.25\n\tangle = 3.14\n\tcityobject = 0\n\n"
        "[4.00]\n\tname = set/set_office\n\tposition = 0, 0\n\n"
        "[5.00]\n\tposition = 1, 1\n";
    const StartingLayout l = ParseStartingLayout(otm::core::IniFile::Parse(sample));
    Check("size", l.size && *l.size == 2.0);
    Check("no year in this file", !l.year);
    Check("four placements (a section without a name is skipped)", l.placements.size() == 4);
    Check("kinds by prefix", l.placements[0].kind == PlacedKind::Facility && l.placements[2].kind == PlacedKind::Ornament && l.placements[3].kind == PlacedKind::Set);
    Check("position and angle", l.placements[1].name == "facility/trailer_3" && l.placements[1].x == 81.34 && l.placements[1].z == 93.23 && l.placements[1].angle == 1.57);
    Check("negative and fractional position", l.placements[0].x == -31.38 && l.placements[2].z == -7.25);
    Check("missing angle is 0", l.placements[3].angle == 0.0);
    Check("cityobject is optional", !l.placements[0].cityObject && l.placements[2].cityObject && *l.placements[2].cityObject == 0);
    Check("no hired staff", !l.staff.present);

    // --- The empty and the year-only files.
    const StartingLayout clean = ParseStartingLayout(otm::core::IniFile::Parse("\tsize = 2.00\n\tsize = 2.00\n"));
    Check("a clean file is just a size", clean.size && clean.placements.empty());
    const StartingLayout y1920 = ParseStartingLayout(otm::core::IniFile::Parse("\tyear = 1920\n\tsize = 2.00\t\n\n\n"));
    Check("1920 has a year and nothing placed", y1920.year && *y1920.year == 1920 && y1920.placements.empty());

    // --- hired_staff (data\movielot.ini).
    const StartingLayout staff = ParseStartingLayout(otm::core::IniFile::Parse("[hired_staff]\n\tbuilders = 2\n\tjanitors = 1\n\tcrew = 3\n\twriters = 4\n[1.00]\n\tname = facility/facility_stage\n\tposition = 1, 2\n"));
    Check("hired staff", staff.staff.present && staff.staff.builders == 2 && staff.staff.janitors == 1 && staff.staff.crew == 3 && staff.staff.writers == 4);
    Check("the hired_staff section is not a placement", staff.placements.size() == 1);

    if (g_failures == 0) std::printf("starting_layout_test: OK\n");
    return g_failures == 0 ? 0 : 1;
}
