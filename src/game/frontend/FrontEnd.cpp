#include "game/frontend/FrontEnd.hpp"

namespace otm::frontend {

namespace {
using Kind = Effect::Kind;

Effect Make(Kind k, int arg = 0) { Effect e{k}; e.arg = arg; return e; }
Effect Movie(const char* path) { Effect e{Kind::PlayMovie}; e.text = path; return e; }
Effect Alpha(double a) { Effect e{Kind::BackgroundAlpha}; e.value = a; return e; }

void Append(std::vector<Effect>& to, std::vector<Effect> from) {
    for (Effect& e : from) to.push_back(std::move(e));
}
}  // namespace

// The inline sequence the original repeats everywhere: if (state != s) { limit = ..; state = s; counter = 0; }
void FrontEnd::Enter(State s, int limit) {
    if (state_ == s) return;
    limit_ = limit;
    state_ = s;
    counter_ = 0;
}

// orig: WFrontEnd_SetState 0x00690E40
std::vector<Effect> FrontEnd::SetState(State s) {
    std::vector<Effect> fx;
    if (s == state_) return fx;
    if (s == State::Boot) {
        limit_ = 1;
    } else if (s == State::Menu) {
        fx.push_back(Make(Kind::BackgroundVisible, 0));          // FUN_006B9380(0), when a background movie object exists
        if (!menuShown_) {
            menuShown_ = true;                                    // +0x344
            fx.push_back(Make(Kind::ShowMenu));
        }
        // the limit is left as it was
    } else if (s == State::Leaving) {
        limit_ = 25;
    } else {
        limit_ = -1;
    }
    state_ = s;
    counter_ = 0;
    return fx;
}

// orig: WFrontEnd_Tick 0x006921C0
std::vector<Effect> FrontEnd::Tick(const TickInput& in) {
    std::vector<Effect> fx;
    ++counter_;   // +0x618 is incremented before the switch

    switch (state_) {
    case State::Boot:
        if (limit_ < counter_) {
            if (in.qualityTier < 2) fx.push_back(Make(Kind::PushAudioState, 4));
            Append(fx, SetState(State::Menu));
        }
        break;

    case State::Menu:
        if (in.backgroundPulses) fx.push_back(Alpha(in.musicVolume * 0.45 + 0.45));
        break;

    case State::ReturnToMenu:
        if (in.movieFinishedOrNone) {
            fx.push_back(Make(Kind::PopAudioState, 0));
            Append(fx, SetState(State::Menu));
            fx.push_back(Make(Kind::BackgroundVisible, 0));
            fx.push_back(Make(Kind::StartMenuReadyTimer));
            menuReady_ = false;
            readyDeadlineMs_ = in.nowMs + 750;
        }
        break;

    case State::CreditsExpack:
    case State::CreditsMain:
        if (in.movieFinishedOrNone) {
            State next;
            if (state_ == State::CreditsExpack) {
                fx.push_back(Movie(ExpackCreditsPath(in.qualityTier, in.expackLowExists)));
                next = State::CreditsMain;
            } else {
                fx.push_back(Movie(CreditsPath(in.qualityTier)));
                next = State::ReturnToMenu;
            }
            Enter(next, -1);
            fx.push_back(Make(Kind::BackgroundVisible, 1));
            fx.push_back(Alpha(0.0));
            fx.push_back(Make(Kind::SetMenuReady, 0));
            menuReady_ = false;
        }
        break;

    case State::Leaving:
        if (limit_ <= counter_) closeRequested_ = true;   // flags |= 1
        break;
    }

    // "Skip Front End" 1 or 2: post a sandbox or a new game once, on the first tick (DAT_0104DB00).
    if (in.skipFrontEndSetting != 0 && !skipFrontEndDone_) {
        if (in.skipFrontEndSetting == 1) fx.push_back(Make(Kind::PostEvent, ev::kSandbox));
        else if (in.skipFrontEndSetting == 2) fx.push_back(Make(Kind::PostEvent, ev::kNewGame));
    }
    skipFrontEndDone_ = true;

    // The menu becomes ready once the 750 ms timer passes.
    if (readyDeadlineMs_ != 0 && readyDeadlineMs_ < in.nowMs) {
        menuReady_ = true;
        readyDeadlineMs_ = 0;
        fx.push_back(Make(Kind::SetMenuReady, 1));
    }
    return fx;
}

// orig: WFrontEnd_OnEvent 0x00690F10
std::vector<Effect> FrontEnd::OnEvent(int id, const EventInput& in) {
    std::vector<Effect> fx;
    if (state_ == State::Leaving) return fx;   // events are ignored while the front end is closing

    switch (id) {
    case ev::kResume:
        if (in.resumeAvailable) {
            Enter(State::Leaving, 25);
            fx.push_back(Make(Kind::ResumeGame));
        }
        break;

    case ev::kNewGame:
        if (in.playedBasics) {
            Enter(State::Leaving, 25);
            fx.push_back(Make(Kind::StartGame, 0));
        } else {
            // New Game before the Basics tutorial has been played runs the tutorial instead.
            fx.push_back(Make(Kind::BackgroundVisible, 1));
            Enter(State::Leaving, 25);
            fx.push_back(Make(Kind::StartTutorial));
        }
        break;

    case ev::kSandbox:
        Enter(State::Leaving, 25);
        fx.push_back(Make(Kind::StartGame, 1));
        break;

    case ev::kAddOnQuickStart:
        Enter(State::Leaving, 25);
        fx.push_back(Make(Kind::StartGame, 3));
        break;

    case ev::kTutorial:
        Enter(State::Leaving, 25);
        fx.push_back(Make(Kind::BackgroundVisible, 1));
        fx.push_back(Make(Kind::StartTutorial));
        break;

    case ev::kOpenGame:
    case ev::kOpenGameAlt:
        fx.push_back(Make(Kind::OpenLoadScreen));
        break;

    case ev::kTrailerEditor:
        fx.push_back(Make(Kind::OpenTrailerEditor));
        fx.push_back(Make(Kind::BackgroundVisible, 1));
        break;

    case ev::kOnline:
        fx.push_back(Make(Kind::OpenOnlineScreen));
        fx.push_back(Make(Kind::BackgroundVisible, 1));
        break;

    case ev::kCredits:
        if (!in.movieHostPresent) break;
        fx.push_back(Make(Kind::BackgroundVisible, 1));
        if (in.completedGame) {
            fx.push_back(Movie(FilmedCreditsPath(in.qualityTier)));
            Enter(State::CreditsExpack, -1);
        } else {
            fx.push_back(Movie(ExpackCreditsPath(in.qualityTier, in.expackLowExists)));
            Enter(State::CreditsMain, -1);
        }
        fx.push_back(Alpha(0.0));
        break;

    default:
        break;   // the Flash panel events (0x80D, 0x835, 0x85D, 0x885, 0x8AD, 0x8D5) are not decoded
    }
    return fx;
}

// ---- Paths ---------------------------------------------------------------------------------------------------------

const char* FilmedCreditsPath(int tier) {
    return tier < 2 ? "data/credits/filmedcredits_low.wmv" : "data/credits/filmedcredits.wmv";
}
const char* ExpackCreditsPath(int tier, bool lowExists) {
    return (tier < 2 && lowExists) ? "data/credits/credits_expack_low.wmv" : "data/credits/credits_expack.wmv";
}
const char* CreditsPath(int tier) {
    return tier < 2 ? "data/credits/credits_low.wmv" : "data/credits/credits.wmv";
}

// ---- Tables --------------------------------------------------------------------------------------------------------

const MenuItem kMenuItems[19] = {
    {"FRONTEND_RESUME", "$resume", false},
    {"FRONTEND_GAME", "$game", false},
    {"FRONTEND_LOAD", "$load", false},
    {"FRONTEND_SAVE", "$save", false},
    {"FRONTEND_NEW", "$newgame", false},
    {"FRONTEND_TUTORIAL", "$tutorial", false},
    {"FRONTEND_SANDBOX", "$sandbox", false},
    {"FRONTEND_ONLINE", "$online", false},
    {"FRONTEND_OPTIONS", "$options", false},
    {"FRONTEND_MOVIEPLAYER", "$movies", false},
    {"FRONTEND_VIDEOOPTION", "$videooption", false},
    {"FRONTEND_AUDIOOPTION", "$audiooption", false},
    {"FRONTEND_GAMEOPTION", "$gameoption", false},
    {"FRONTEND_ONLINEOPTION", "$onlineoption", false},
    {"FRONTEND_CREDITS", "$credits", false},
    {"FRONTEND_QUIT", "$quit", false},
    {"FRONTEND_QUITQUESTION", "$quitquestion", false},
    {"FRONTEND_QUICKSTART", "$addon1quickstart", true},
    {"FRONTEND_CONTINUE", "$continue", true},
};

using A = ExternCallback::Action;
const ExternCallback kExternCallbacks[35] = {
    {"ExternResIncrease", A::AdjustSetting, static_cast<int>(Setting::Resolution), +1, false},
    {"ExternResDecrease", A::AdjustSetting, static_cast<int>(Setting::Resolution), -1, false},
    {"ExternDiffIncrease", A::AdjustSetting, static_cast<int>(Setting::Difficulty), +1, false},
    {"ExternDiffDecrease", A::AdjustSetting, static_cast<int>(Setting::Difficulty), -1, false},
    {"ExternBloodIncrease", A::AdjustSetting, static_cast<int>(Setting::Blood), +1, false},
    {"ExternBloodDecrease", A::AdjustSetting, static_cast<int>(Setting::Blood), -1, false},
    {"ExternDetailIncrease", A::AdjustSetting, static_cast<int>(Setting::Detail), +1, false},
    {"ExternDetailDecrease", A::AdjustSetting, static_cast<int>(Setting::Detail), -1, false},
    {"ExternMusicVolUp", A::AdjustVolume, 1, +1, false},
    {"ExternMusicVolDown", A::AdjustVolume, 1, -1, false},
    {"ExternSoundVolUp", A::AdjustVolume, 2, +1, false},
    {"ExternSoundVolDown", A::AdjustVolume, 2, -1, false},
    {"ExternStartNewGame", A::PostEvent, ev::kNewGame, 0, false},
    {"ExternStartSandbox", A::PostEvent, ev::kSandbox, 0, false},
    {"ExternQuitGame", A::QuitGame, 0, 0, false},
    {"ExternOpenGame", A::PostEvent, ev::kOpenGame, 0, false},
    {"cb_trailereditor", A::PostEvent, ev::kTrailerEditor, 0, false},
    {"ExternOnline", A::PostEvent, ev::kOnline, 0, false},
    {"ExternCredits", A::PostEvent, ev::kCredits, 0, false},
    {"ExternTutorial", A::PostEvent, ev::kTutorial, 0, false},
    {"ExternResume", A::PostEvent, ev::kResume, 0, false},
    {"ExternGamebutOpen", A::Other, 0, 0, false},      // FUN_0068FEE0: "saveon", "savebutton"
    {"ExternGamebutClosed", A::Other, 0, 0, false},    // FUN_0068FE10: "saveoff", "savebutton"
    {"ExternSave", A::Other, 0, 0, false},             // 0x68FAD0, not read
    {"ExternAudioClose", A::CloseDialog, 0, 0, false},      // FUN_006376D0
    {"ExternVideoClose", A::CloseDialog, 1, 0, false},      // FUN_0081A420
    {"ExternOnlineClose", A::CloseDialog, 2, 0, false},     // FUN_006BBE60
    {"ExternGameplayClose", A::CloseDialog, 3, 0, false},   // FUN_00699510
    {"ExternOptionsClickedOpen", A::Panel, 0, +1, false},
    {"ExternOptionsClickedClose", A::Panel, 0, -1, false},
    {"ExternQuitClickedOpen", A::Panel, 1, +1, false},
    {"ExternQuitClickedClose", A::Panel, 1, -1, false},
    {"ExternEnterMain", A::Panel, 2, 0, false},
    {"AddOn1Qstart", A::PostEvent, ev::kAddOnQuickStart, 0, true},
    {"ExternContinue", A::Other, 0, 0, true},          // FUN_00692530, not read
};

SettingRange RangeOf(Setting s) {
    switch (s) {
    case Setting::Resolution: return {0, 3};   // +0x6EC
    case Setting::Difficulty: return {0, 2};   // +0x694
    case Setting::Blood:      return {0, 4};   // +0x698
    case Setting::Detail:     return {0, 4};   // +0x6F0
    }
    return {0, 0};
}

}  // namespace otm::frontend
