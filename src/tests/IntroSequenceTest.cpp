// Walks the intro state machine through the same transitions UpdateIntroSplashScreens (0x0045E3F0) makes. These are
// derived from the decompile, not measured at runtime (no run covers boot yet; docs/BOOT.md).
#include <cstdio>
#include <cstring>

#include "game/boot/IntroSequence.hpp"

using namespace otm::boot;

static int g_failures = 0;
static void Check(const char* what, bool ok) {
    if (!ok) { std::printf("FAIL %s\n", what); ++g_failures; }
}
static bool Shows(const IntroSequence& s, PresentKind k, const char* path) {
    const Presentation p = s.current();
    return p.kind == k && ((!p.path && !path) || (p.path && path && std::strcmp(p.path, path) == 0));
}

int main() {
    // --- Low tier (image mode), first launch: every splash runs its full time; only Lionhead/Activision are skippable.
    {
        IntroSequence s(MakeIntroConfig(0, 1, false));
        IntroInput in;
        in.nowMs = 1000;
        Check("starts in state 0", s.state() == IntroState::Start);
        Check("first update is not done", !s.Update(in));
        Check("lionhead image", s.state() == IntroState::Lionhead && Shows(s, PresentKind::Image, "ui/lionhead_splash.dds"));
        in.nowMs = 3999; s.Update(in);
        Check("lionhead holds before 3 s", s.state() == IntroState::Lionhead);
        in.nowMs = 4000; s.Update(in);
        Check("activision image", s.state() == IntroState::Activision && Shows(s, PresentKind::Image, "ui/activision_screen.dds"));
        s.RequestSkip(); s.Update(in);
        Check("skip works on activision", s.state() == IntroState::Intel && Shows(s, PresentKind::Image, "ui/intel_splash.dds"));
        s.RequestSkip(); s.Update(in);
        Check("skip ignored on intel, first launch", s.state() == IntroState::Intel);
        in.nowMs = 7000; s.Update(in);
        Check("ati", s.state() == IntroState::Ati && Shows(s, PresentKind::Image, "ui/ati_splash.dds"));
        // The skip requested during Intel was cleared by the transition into Ati: it must not carry over.
        in.nowMs = 7001; s.Update(in);
        Check("skip flag cleared by transition", s.state() == IntroState::Ati);
        in.nowMs = 10000;
        Check("done after ati", s.Update(in) && s.done() && Shows(s, PresentKind::None, nullptr));
    }

    // --- Second launch: the vendor splashes become skippable.
    {
        IntroSequence s(MakeIntroConfig(0, 2, false));
        IntroInput in; in.nowMs = 0;
        s.Update(in);                       // -> lionhead
        s.RequestSkip(); s.Update(in);      // -> activision
        s.RequestSkip(); s.Update(in);      // -> intel
        s.RequestSkip(); s.Update(in);      // -> ati
        Check("intel skippable on 2nd launch", s.state() == IntroState::Ati);
        s.RequestSkip();
        Check("ati skippable on 2nd launch", s.Update(in));
    }

    // --- Higher tier: the animated logo and the video, driven by the platform layer's signals.
    {
        IntroSequence s(MakeIntroConfig(2, 5, false));
        IntroInput in; in.nowMs = 500;
        s.Update(in);
        Check("logo screen", s.state() == IntroState::Lionhead && Shows(s, PresentKind::LogoScreen, nullptr));
        in.nowMs = 600000; s.Update(in);
        Check("logo screen ignores the clock", s.state() == IntroState::Lionhead);
        s.RequestSkip(); s.Update(in);
        Check("logo screen ignores skip", s.state() == IntroState::Lionhead);
        in.logoScreenDone = true; s.Update(in);
        Check("movie", s.state() == IntroState::Activision && Shows(s, PresentKind::Movie, "data/intro/atvi_logo.wmv"));
        Check("no skip pending after entry", !s.wantsMovieSkip());
        s.RequestSkip();
        Check("skip asks the movie to stop", s.wantsMovieSkip() && s.state() == IntroState::Activision);
        s.Update(in);
        Check("movie must report done", s.state() == IntroState::Activision);
        in.movieDone = true; s.Update(in);
        Check("intel after movie", s.state() == IntroState::Intel && !s.wantsMovieSkip());
    }

    // --- Chinese legal notice first: 12 s (skippable), then the normal sequence.
    {
        IntroSequence s(MakeIntroConfig(0, 1, true));
        IntroInput in; in.nowMs = 100;
        s.Update(in);
        Check("legal first", s.state() == IntroState::LegalNotice && Shows(s, PresentKind::Image, "legal/chineselegal.jpg"));
        in.nowMs = 12099; s.Update(in);
        Check("legal holds 12 s", s.state() == IntroState::LegalNotice);
        in.nowMs = 12100; s.Update(in);
        Check("then lionhead", s.state() == IntroState::Lionhead);
    }
    {
        IntroSequence s(MakeIntroConfig(0, 1, true));
        IntroInput in; s.Update(in);
        s.RequestSkip(); s.Update(in);
        Check("legal skippable even on first launch", s.state() == IntroState::Lionhead);
    }

    // --- The pump and the boot fork.
    Check("kill focus dropped", ClassifyPumpMessage(0x08) == PumpAction::Drop);
    Check("sys key up dropped", ClassifyPumpMessage(0x105) == PumpAction::Drop);
    Check("close quits", ClassifyPumpMessage(0x10) == PumpAction::Quit);
    Check("quit quits", ClassifyPumpMessage(0x12) == PumpAction::Quit);
    Check("key down dispatched", ClassifyPumpMessage(0x100) == PumpAction::Dispatch);
    Check("skip front end", ChooseBootPath(1) == BootPath::GameLoopOnly);
    Check("default boot", ChooseBootPath(0) == BootPath::IntroThenGameLoop);

    if (g_failures == 0) std::printf("intro_sequence_test: OK\n");
    return g_failures == 0 ? 0 : 1;
}
