#include "game/boot/IntroSequence.hpp"

namespace otm::boot {

namespace {
constexpr Presentation kLionheadImage{PresentKind::Image, "ui/lionhead_splash.dds"};
constexpr Presentation kLogoScreen{PresentKind::LogoScreen, nullptr};
constexpr Presentation kActivisionImage{PresentKind::Image, "ui/activision_screen.dds"};
constexpr Presentation kActivisionMovie{PresentKind::Movie, "data/intro/atvi_logo.wmv"};
constexpr Presentation kIntelImage{PresentKind::Image, "ui/intel_splash.dds"};
constexpr Presentation kAtiImage{PresentKind::Image, "ui/ati_splash.dds"};
constexpr Presentation kLegalImage{PresentKind::Image, "legal/chineselegal.jpg"};
}  // namespace

IntroConfig MakeIntroConfig(int qualityTier, int openCount, bool legalNoticeFirst) {
    IntroConfig c;
    c.imageMode = qualityTier == 0;
    c.skippableVendorSplashes = openCount > 1;
    c.legalNoticeFirst = legalNoticeFirst;
    return c;
}

// Every state entry clears the skip flag (the original writes +0x14 = 0 in each case), then shows the new screen.
void IntroSequence::Enter(IntroState next, Presentation p, std::uint32_t nowMs, std::uint32_t durationMs) {
    skip_ = false;
    state_ = next;
    present_ = p;
    deadlineMs_ = nowMs + durationMs;
}

void IntroSequence::EnterLionhead(std::uint32_t nowMs) {
    // Image mode: the still for 3 s. Otherwise the animated logo, which ends by itself (no deadline is set).
    if (cfg_.imageMode) Enter(IntroState::Lionhead, kLionheadImage, nowMs, cfg_.splashMs);
    else                Enter(IntroState::Lionhead, kLogoScreen, nowMs, 0);
}

void IntroSequence::EnterActivision(std::uint32_t nowMs) {
    if (cfg_.imageMode) Enter(IntroState::Activision, kActivisionImage, nowMs, cfg_.splashMs);
    else                Enter(IntroState::Activision, kActivisionMovie, nowMs, 0);
}

void IntroSequence::EnterIntel(std::uint32_t nowMs) { Enter(IntroState::Intel, kIntelImage, nowMs, cfg_.splashMs); }
void IntroSequence::EnterAti(std::uint32_t nowMs) { Enter(IntroState::Ati, kAtiImage, nowMs, cfg_.splashMs); }
void IntroSequence::EnterLegalNotice(std::uint32_t nowMs) { Enter(IntroState::LegalNotice, kLegalImage, nowMs, cfg_.legalNoticeMs); }

// orig: UpdateIntroSplashScreens 0x0045E3F0
bool IntroSequence::Update(const IntroInput& in) {
    switch (state_) {
    case IntroState::Start:
        if (cfg_.legalNoticeFirst) EnterLegalNotice(in.nowMs);
        else EnterLionhead(in.nowMs);
        break;

    case IntroState::Lionhead:
        if (cfg_.imageMode) {
            if (skip_ || TimedOut(in.nowMs)) EnterActivision(in.nowMs);
        } else if (in.logoScreenDone) {
            EnterActivision(in.nowMs);
        }
        break;

    case IntroState::Activision:
        if (cfg_.imageMode) {
            if (skip_ || TimedOut(in.nowMs)) EnterIntel(in.nowMs);
        } else if (in.movieDone) {
            // The video stops on a skip request (wantsMovieSkip) and then reports done.
            EnterIntel(in.nowMs);
        }
        break;

    case IntroState::Intel:
        // Skippable only from the second launch on; otherwise the full 3 s.
        if ((skip_ && cfg_.skippableVendorSplashes) || TimedOut(in.nowMs)) EnterAti(in.nowMs);
        break;

    case IntroState::Ati:
        if ((skip_ && cfg_.skippableVendorSplashes) || TimedOut(in.nowMs)) {
            skip_ = false;
            state_ = IntroState::Done;
            present_ = {};
        }
        break;

    case IntroState::LegalNotice:
        if (skip_ || TimedOut(in.nowMs)) EnterLionhead(in.nowMs);
        break;

    case IntroState::Done:
        break;
    }
    return done();
}

PumpAction ClassifyPumpMessage(std::uint32_t message) {
    switch (message) {
    case 0x08:   // WM_KILLFOCUS
    case 0x105:  // WM_SYSKEYUP
        return PumpAction::Drop;
    case 0x10:   // WM_CLOSE
    case 0x12:   // WM_QUIT
        return PumpAction::Quit;
    default:
        return PumpAction::Dispatch;
    }
}

BootPath ChooseBootPath(int skipFrontEndSetting) {
    return skipFrontEndSetting != 0 ? BootPath::GameLoopOnly : BootPath::IntroThenGameLoop;
}

}  // namespace otm::boot
