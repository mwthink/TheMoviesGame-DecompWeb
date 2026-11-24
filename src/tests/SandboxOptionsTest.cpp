// Checks the sandbox options against what the decompile and the disassembly say (docs/FRONTEND.md); not against the running game.
#include <cstdio>

#include "game/sandbox/SandboxOptions.hpp"

using namespace otm::sandbox;

static int g_failures = 0;
static void Check(const char* what, bool ok) {
    if (!ok) { std::printf("FAIL %s\n", what); ++g_failures; }
}

int main() {
    {
        const Options d = DefaultOptions();
        Check("defaults: no decade chosen, new game", d.get(Option::StartDecade) == -1.0f && d.get(Option::GameType) == 1.0f);
        Check("defaults: all the rule switches off", d.get(Option::StarsDontMisbehave) == 0 && d.get(Option::BuildingsDontDecay) == 0 && d.get(Option::InstantMovie) == 0 &&
                                                      d.get(Option::Unused) == 0 && d.get(Option::InstantBuild) == 0);
        Check("defaults with the add-on gate: stunts and injuries on (options 7 and 8 are 0)", d.get(Option::StuntInjuriesOff) == 0 && d.get(Option::StuntmenOff) == 0);
        const Options base = DefaultOptions(false);
        Check("without the gate they are 1.0", base.get(Option::StuntInjuriesOff) == 1.0f && base.get(Option::StuntmenOff) == 1.0f);
    }
    {
        // The sandbox screen's own defaults (WSandboxOptions constructor): decay on, everything else off, ready-built lot on.
        SandboxChoices c;
        Check("screen defaults", c.buildingsDecay && !c.instantBuild && !c.instantShoot && !c.starsDontMisbehave && !c.stuntmen && !c.stuntInjuries && c.readyBuiltLot);
        Options o = DefaultOptions();
        ApplySandboxChoices(o, c);
        Check("sandbox with the screen defaults: game type 2", o.get(Option::GameType) == 2.0f);
        Check("... decay on, so option 2 is 0", o.get(Option::BuildingsDontDecay) == 0.0f);
        Check("... stuntmen and injuries off on the screen, so options 8 and 7 are 1.0", o.get(Option::StuntmenOff) == 1.0f && o.get(Option::StuntInjuriesOff) == 1.0f);
        Check("... the other switches stay 0", o.get(Option::InstantBuild) == 0 && o.get(Option::InstantMovie) == 0 && o.get(Option::StarsDontMisbehave) == 0);
        Check("... option 0 and the unused one are not touched", o.get(Option::StartDecade) == -1.0f && o.get(Option::Unused) == 0.0f);
    }
    {
        SandboxChoices c; c.instantBuild = c.instantShoot = c.starsDontMisbehave = true; c.buildingsDecay = false; c.stuntmen = c.stuntInjuries = true;
        Options o = DefaultOptions(false);
        ApplySandboxChoices(o, c);
        Check("everything switched on", o.get(Option::InstantBuild) == 1 && o.get(Option::InstantMovie) == 1 && o.get(Option::StarsDontMisbehave) == 1 && o.get(Option::BuildingsDontDecay) == 1);
        Check("stuntmen and injuries ticked mean options 8 and 7 are 0", o.get(Option::StuntmenOff) == 0 && o.get(Option::StuntInjuriesOff) == 0);
    }
    {
        Options o = DefaultOptions();
        SetStartYear(o, 1960);
        Check("1960 is decade 6", o.get(Option::StartDecade) == 6.0f);
        Check("and reads back as 1960", StartYear(o) == 1960);
        SetStartYear(o, 1967);
        Check("a year inside a decade rounds down", o.get(Option::StartDecade) == 6.0f && StartYear(o) == 1960);
        SetStartYear(o, 2000);
        Check("2000 is decade 10", o.get(Option::StartDecade) == 10.0f);
        Check("the unset value reads as 1890", StartYear(DefaultOptions()) == 1890);
    }
    Check("nine options", kOptionCount == 9 && static_cast<int>(Option::StuntmenOff) == 8);

    if (g_failures == 0) std::printf("sandbox_options_test: OK\n");
    return g_failures == 0 ? 0 : 1;
}
