// The start of the game: from WinMain's fork to the end of the intro splash screens, after which the game proper
// (Game_MainLoop, which hosts the WFrontEnd main menu) takes over.
//
// Reimplemented from:
//   WinMain                    0x00542B20  the fork: ShouldSkipFrontEnd() || LH_MasterGameLoop() == 0  ->  Game_MainLoop()
//   ShouldSkipFrontEnd         0x004EF580  config int "Skip Front End" (default 0) != 0
//   GameStateManager ctor      0x0045E220  reads "Open Count" and the quality tier
//   UpdateIntroSplashScreens   0x0045E3F0  the per-frame state machine
//   (state entry)              0x0045E2F0  what each state shows and for how long
//   LH_MasterGameLoop          0x0045E720  the pump around it
// Derivation and open questions: docs/BOOT.md.
//
// This is only the decision logic. It owns no window, renderer, clock or movie player: the caller feeds it the time and
// what the platform layer observed, and draws whatever current() says.
#pragma once

#include <cstdint>

namespace otm::boot {

// GameStateManager +0x04. 5 is the Chinese legal notice, reachable only from Start.
enum class IntroState : int { Start = 0, Lionhead = 1, Activision = 2, Intel = 3, Ati = 4, LegalNotice = 5, Done = 6 };

enum class PresentKind { None, Image, LogoScreen, Movie };

// What the platform layer should be showing. path is null for LogoScreen (the animated Lionhead logo, LogoScreen_Initialize
// 0x009ECDA0) and None.
struct Presentation {
    PresentKind kind = PresentKind::None;
    const char* path = nullptr;
};

struct IntroConfig {
    // GameStateManager +0x16 = (DAT_0105be08 == 0): the lowest quality tier shows still images instead of the logo animation
    // and the Activision video.
    bool imageMode = false;
    // GameStateManager +0x15 = (Open Count > 1): the Intel and ATI splashes may be skipped only from the second launch on.
    bool skippableVendorSplashes = false;
    // FUN_009B4250() == 0xD at state 0: show legal/chineselegal.jpg first (12 s), then carry on as normal.
    bool legalNoticeFirst = false;
    std::uint32_t splashMs = 3000;       // each still image
    std::uint32_t legalNoticeMs = 12000;
};

// DAT_0105be08 is the quality tier (0 = lowest); openCount is the registry "Open Count" read when the manager is built.
IntroConfig MakeIntroConfig(int qualityTier, int openCount, bool legalNoticeFirst);

// What the platform layer observed this frame.
struct IntroInput {
    std::uint32_t nowMs = 0;       // GetTickCount()
    bool logoScreenDone = false;   // FUN_009EC720: Esc or Space held with the game window in front, or the fade reached 400
    bool movieDone = false;        // the Activision video finished (or there is no player)
};

class IntroSequence {
public:
    explicit IntroSequence(const IntroConfig& config) : cfg_(config) {}

    // GameStateManager +0x14: the user asked to skip the current screen. Cleared whenever the state changes.
    void RequestSkip() { skip_ = true; }

    // One frame of UpdateIntroSplashScreens. Returns true once the sequence is complete (state 6).
    bool Update(const IntroInput& in);

    IntroState state() const { return state_; }
    bool done() const { return state_ == IntroState::Done; }
    Presentation current() const { return present_; }
    // True while the Activision video is playing and a skip is pending: the caller should stop the movie (vtable +0x1C).
    bool wantsMovieSkip() const { return state_ == IntroState::Activision && !cfg_.imageMode && skip_; }

private:
    void Enter(IntroState next, Presentation p, std::uint32_t nowMs, std::uint32_t durationMs);
    void EnterLionhead(std::uint32_t nowMs);
    void EnterActivision(std::uint32_t nowMs);
    void EnterIntel(std::uint32_t nowMs);
    void EnterAti(std::uint32_t nowMs);
    void EnterLegalNotice(std::uint32_t nowMs);
    bool TimedOut(std::uint32_t nowMs) const { return deadlineMs_ <= nowMs; }  // unsigned, like the original

    IntroConfig cfg_;
    IntroState state_ = IntroState::Start;
    Presentation present_;
    std::uint32_t deadlineMs_ = 0;   // GameStateManager +0x08
    bool skip_ = false;              // GameStateManager +0x14
};

// What LH_MasterGameLoop does with a message it pulled off the queue.
enum class PumpAction { Dispatch, Drop, Quit };
// WM_KILLFOCUS (0x08) and WM_SYSKEYUP (0x105) are dropped, WM_CLOSE (0x10) and WM_QUIT (0x12) end the loop, the rest is
// translated and dispatched. (The quit messages are consumed, not re-posted.)
PumpAction ClassifyPumpMessage(std::uint32_t message);

enum class BootPath {
    IntroThenGameLoop,   // LH_MasterGameLoop() runs first, then Game_MainLoop() (see docs/BOOT.md for the unread return value)
    GameLoopOnly,        // ShouldSkipFrontEnd(): straight to Game_MainLoop()
};
// WinMain: the "Skip Front End" config int (default 0) selects the path.
BootPath ChooseBootPath(int skipFrontEndSetting);

}  // namespace otm::boot
