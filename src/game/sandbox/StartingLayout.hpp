// The starting studio of a new game: which layout file is loaded and what is in it.
//
// Reimplemented from:
//   Campaign_Begin            0x004AF870   builds the layout name (savedefaults/<year or tutorial>[_clean]) and passes it to Game_ConstructSystems
//   Lot_LoadStartingLayout    0x0046A780   an empty name means "lots/basic_lot"; loads <name> and "data/<name>.lnd" (the terrain)
//   Lot_LoadLayoutFile        0x0046BAB0   resets the lot, parses <name> with the property reader, then runs the two functions below
//   Lot_PlaceAssetsFromProperties 0x0046AF20  walks the sections: name prefix facility/, set or ornament/; keys position, angle, cityobject
//   Lot_HireStartingStaff     0x0046AB70   the "hired_staff" section: builders, janitors, crew, writers
// The files are in the pak archives (MISC0000.pak, data\savedefaults\ and data\lots\); docs/NEW_GAME.md has what is in them. Not compared with the
// running game.
#pragma once

#include <optional>
#include <string>
#include <vector>

#include "core/Ini.hpp"
#include "game/sandbox/SandboxOptions.hpp"

namespace otm::sandbox {

struct LayoutName {
    std::string name;                 // e.g. "savedefaults/1960", "savedefaults/1960_clean", "savedefaults/tutorial"
    bool clearEmptyLotFlag = false;   // Campaign_Begin sets DAT_0104DE24 back to 0 after using it
};

// orig: Campaign_Begin 0x004AF870: "savedefaults/" + ("tutorial" if tutorial, else the start year printed with %d), then "_clean" when the
// empty-lot flag (DAT_0104DE24) is set and the game type is sandbox (2) or add-on quick start (3). The year is not rounded here: the files exist per decade
// (1900, 1910, ..., 2000), so the caller is expected to pass a decade year, as the profile screen does.
LayoutName StartingLayoutName(bool tutorial, int startYear, GameType type, bool emptyLotFlag);

enum class PlacedKind { Facility, Set, Ornament, Other };

struct Placement {
    std::string section;     // "1.00", "2.00", ...
    std::string name;        // e.g. facility/facility_stage
    PlacedKind kind = PlacedKind::Other;
    double x = 0.0, z = 0.0; // "position = x, z"
    double angle = 0.0;      // radians
    std::optional<int> cityObject;   // the optional "cityobject" key
};

struct HiredStaff { bool present = false; int builders = 0, janitors = 0, crew = 0, writers = 0; };

struct StartingLayout {
    std::optional<double> size;      // "size = 2.00", before the first section (a lot size tier, CLot_ApplySizeTier)
    std::optional<int> year;         // "year = 1920" appears in a few files
    std::vector<Placement> placements;
    HiredStaff staff;                // present only in some files (data/movielot.ini)
};

PlacedKind KindOfName(const std::string& name);   // by prefix: "facility/", "set/", "ornament/"

// orig: Lot_PlaceAssetsFromProperties 0x0046AF20 and Lot_HireStartingStaff 0x0046AB70. Sections without a name key, and the hired_staff section, are not placements.
StartingLayout ParseStartingLayout(const core::IniFile& ini);

}  // namespace otm::sandbox
