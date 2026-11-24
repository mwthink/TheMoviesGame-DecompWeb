#include "game/sandbox/SandboxOptions.hpp"

namespace otm::sandbox {

// orig: CSandbox_ResetOptions 0x004AF370
Options DefaultOptions(bool stuntContentEnabled) {
    Options o;
    o.set(Option::StartDecade, -1.0f);
    o.set(Option::GameType, 1.0f);
    const float stunts = stuntContentEnabled ? 0.0f : 1.0f;
    o.set(Option::StuntInjuriesOff, stunts);
    o.set(Option::StuntmenOff, stunts);
    return o;
}

// orig: WProfileScreen_OnConfirm 0x006E1220, case 1
void ApplySandboxChoices(Options& o, const SandboxChoices& c) {
    o.set(Option::GameType, 2.0f);
    o.set(Option::StarsDontMisbehave, c.starsDontMisbehave ? 1.0f : 0.0f);
    o.set(Option::BuildingsDontDecay, c.buildingsDecay ? 0.0f : 1.0f);   // [2] = (+0x77F == 0)
    o.set(Option::InstantBuild, c.instantBuild ? 1.0f : 0.0f);
    o.set(Option::InstantMovie, c.instantShoot ? 1.0f : 0.0f);
    o.set(Option::StuntmenOff, c.stuntmen ? 0.0f : 1.0f);                // [8] = (+0x780 == 0)
    o.set(Option::StuntInjuriesOff, c.stuntInjuries ? 0.0f : 1.0f);      // [7] = (+0x781 == 0)
}

// orig: Campaign_Begin 0x004AF870 stores (float)((year - 0x76C) / 10); 0x76C is 1900
void SetStartYear(Options& o, int year) { o.set(Option::StartDecade, static_cast<float>((year - 1900) / 10)); }

int StartYear(const Options& o) { return static_cast<int>(o.get(Option::StartDecade) * 10.0f + 1900.0f); }

}  // namespace otm::sandbox
