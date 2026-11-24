// The nine start options (TM::CSandbox, "Option[0..8]" in a save file) and the sandbox screen's checkboxes that set them.
//
// Reimplemented from:
//   CSandbox_ResetOptions            0x004AF370   the defaults
//   WProfileScreen_OnConfirm         0x006E1220   case 1 (sandbox): which checkbox sets which option
//   WSandboxOptions                  0x0070D020   the checkboxes, their defaults and toggle handlers
//   CSandbox_RegisterSaveVariables   0x004AF720   nine 4-byte values, saved in every save game
//   Campaign_Begin                   0x004AF870   writes the start decade
// What each option does in the game was read from its readers (see docs/FRONTEND.md, "The nine start options"). Nothing here has been
// compared with the running game.
#pragma once

namespace otm::sandbox {

// The option array at CSandbox +0x60, nine floats.
enum class Option : int {
    StartDecade = 0,        // (startYear - 1900) / 10; -1.0 until a year is chosen. Read by the start-date setter: decade * 10 + 1900
    StarsDontMisbehave = 1, // != 0: CMood_Recalculate is skipped (moods stay put), the work bar's Stress and Boredom and the star's addiction levels are held at 0, and a character's top desire counts as 0
    BuildingsDontDecay = 2, // > 0: an asset's condition is held at 1.0 and its disrepair flags are cleared
    InstantMovie = 3,       // > 0: a take ends as soon as it begins (the stunt outcome is rolled once) and the pre-production factor is 1.0
    Unused = 4,             // nothing ever sets it; DesireWriteScript_UpdateProgress would skip the "Writing" progress if it were > 0
    InstantBuild = 5,       // != 0: a placed asset goes straight to its built state (4) instead of under construction (1)
    GameType = 6,           // 0 tutorial, 1 new game, 2 sandbox, 3 add-on quick start
    StuntInjuriesOff = 7,   // != 0: the health setters (CStar, CExtra, CWannabe) store 1.0 instead of the value passed in, so health cannot drop
    StuntmenOff = 8,        // != 0: stunt and stuntman paths are skipped (stunt rolls, leads room, script room, reviews, release screen, the tutorial popup)
};
constexpr int kOptionCount = 9;

enum class GameType : int { Tutorial = 0, NewGame = 1, Sandbox = 2, AddOnQuickStart = 3 };

struct Options {
    float v[kOptionCount] = {};
    float get(Option o) const { return v[static_cast<int>(o)]; }
    void set(Option o, float x) { v[static_cast<int>(o)] = x; }
};

// orig: CSandbox_ResetOptions 0x004AF370. [0] = -1.0, [1..5] = 0, [6] = 1.0 (new game); [7] and [8] are 0 when FUN_00541F60(0) is true,
// which is always (it returns `param == 0`, the call passes 0) and 1.0 otherwise.
Options DefaultOptions(bool stuntContentEnabled = true);

// The sandbox options screen (WSandboxOptions). The bytes are the object's fields; the original flips each with `x = (x == 0)`.
struct SandboxChoices {
    bool instantBuild = false;         // +0x77C
    bool instantShoot = false;         // +0x77D
    bool starsDontMisbehave = false;   // +0x77E
    bool buildingsDecay = true;        // +0x77F   (the row is labelled "Buildings Don't Decay", so it reads inverted)
    bool stuntmen = false;             // +0x780   (add-on)
    bool stuntInjuries = false;        // +0x781   (add-on)
    bool readyBuiltLot = true;         // DAT_0104DE24, a global: "Start With A Ready Built Studio Lot" (ON = a basic setup, OFF = an empty lot). Campaign_Begin appends "_clean" to a path string that nothing uses and clears it; no real consumer was found
};

// orig: WProfileScreen_OnConfirm 0x006E1220, case 1. Sets GameType = 2.0 and six options from the checkboxes; the others keep their values.
void ApplySandboxChoices(Options& options, const SandboxChoices& c);

// orig: Campaign_Begin 0x004AF870: option 0 = (year - 1900) / 10, integer division.
void SetStartYear(Options& options, int year);
int StartYear(const Options& options);   // the inverse the date setter uses: decade * 10 + 1900

}  // namespace otm::sandbox
