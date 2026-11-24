// The main menu (the WFrontEnd window): its state machine, its event handler and its two tables.
//
// Reimplemented from:
//   WFrontEnd_Tick                      0x006921C0   the per-frame state machine
//   WFrontEnd_SetState                  0x00690E40   state, frame counter and limit
//   WFrontEnd_OnEvent                   0x00690F10   what a menu event does
//   WFrontEnd_SetupMenuItems            0x00693C80   the 19 captions and $commands
//   WFrontEnd_RegisterExternCallbacks   0x00692A90   the 35 callbacks the menu's Flash movie calls
// Derivation, the open questions and what was not read: docs/FRONTEND.md. This was read from the decompile and the disassembly;
// nothing here has been compared with the running game.
//
// It owns no window, movie player or game: the caller passes in what it observed and applies the returned effects.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace otm::frontend {

// WFrontEnd +0x610. The names say what the state does; the originals are plain numbers.
enum class State : int {
    Boot = 0,            // waits for the frame counter to pass the limit (10 after construction), then shows the menu
    Menu = 1,            // the menu is up; the background movie's volume follows the music volume
    ReturnToMenu = 2,    // waits for the current movie to end, then shows the menu again
    CreditsExpack = 3,   // when the current movie ends, plays the expansion credits and moves on to CreditsMain
    CreditsMain = 4,     // when the current movie ends, plays the main credits and moves on to ReturnToMenu
    Leaving = 5,         // after 25 frames asks the window to close; ignores events meanwhile
};

// EventManager ids the menu posts and handles.
namespace ev {
constexpr int kNewGame = 0x515;
constexpr int kSandbox = 0x5B5;
constexpr int kOpenGame = 0x5DD;
constexpr int kOpenGameAlt = 0x605;     // handled like kOpenGame; who posts it is not known
constexpr int kTrailerEditor = 0x62D;
constexpr int kCredits = 0x71D;
constexpr int kTutorial = 0x795;
constexpr int kOnline = 0x7BD;
constexpr int kResume = 0x7E5;
constexpr int kAddOnQuickStart = 0x8FD;
}  // namespace ev

// What the caller must do. Order matters; the effects of one call are listed in the order the original ran them.
struct Effect {
    enum class Kind {
        PushAudioState,       // arg = the audio state id: Audio_SetState(arg, frontEnd, 1) (FUN_004F98F0 on the audio manager)
        PopAudioState,        // arg = the audio state id: Audio_RemoveState(arg, frontEnd, 1) (FUN_004F9B70)
        ShowMenu,             // the first time the menu is shown: builds the menu (FUN_004237F0, FUN_00424130(2,0,0), ...)
        BackgroundVisible,    // arg = 1 show, 0 hide the background movie (FUN_006B9380; 0 shows, 1 hides)
        BackgroundAlpha,      // value = the alpha to set on the background movie
        PlayMovie,            // text = path; the movie player is opened and played
        StartMenuReadyTimer,  // WFrontEnd_StartMenuReadyTimer: the menu becomes ready 750 ms later
        SetMenuReady,         // arg = 0 or 1 (DAT_00E5E281)
        RequestClose,         // the window's flags |= 1: the front end closes
        PostEvent,            // arg = event id
        StartGame,            // arg = mode: 0 new game, 1 sandbox, 3 add-on quick start (NewGame_Start)
        StartTutorial,        // the Basics tutorial path (also used by New Game when "Played Basics" is false)
        ResumeGame,           // DAT_0104A982 = 1
        OpenLoadScreen,
        OpenOnlineScreen,
        OpenTrailerEditor,
    };
    Kind kind;
    int arg = 0;
    double value = 0.0;
    std::string text;
};

struct TickInput {
    int qualityTier = 0;                    // DAT_0105BE08
    bool movieFinishedOrNone = true;        // no movie player, or the player reports the movie finished (vtable +0x28)
    bool expackLowExists = false;           // FUN_009D3660: data/credits/credits_expack_low.wmv can be opened
    bool backgroundPulses = false;          // the background movie object exists and +0x6E5 is set
    double musicVolume = 1.0;               // channel 1, FUN_004F30A0
    std::uint32_t nowMs = 0;                // Timer_GetMilliseconds
    int skipFrontEndSetting = 0;            // the "Skip Front End" config int: 1 starts a sandbox, 2 a new game, once
};

struct EventInput {
    int qualityTier = 0;
    bool resumeAvailable = false;           // +0x60C: there is a game to resume
    bool playedBasics = false;              // config "Played Basics"
    bool completedGame = false;             // config "CompletedGame"
    bool expackLowExists = false;
    bool movieHostPresent = true;           // the movie player object (+0x640) exists
};

class FrontEnd {
public:
    // Construction: state Boot, counter 0, limit 10 (WFrontEnd_Constructor 0x00695460).
    FrontEnd() = default;

    // orig: WFrontEnd_Tick 0x006921C0. The counter is incremented first, then the state's rule runs.
    std::vector<Effect> Tick(const TickInput& in);

    // orig: WFrontEnd_OnEvent 0x00690F10. Returns the effects of one event. Events that are not handled return nothing.
    std::vector<Effect> OnEvent(int eventId, const EventInput& in);

    // orig: WFrontEnd_SetState 0x00690E40. Does nothing if the state is unchanged.
    std::vector<Effect> SetState(State s);

    State state() const { return state_; }
    int frameCounter() const { return counter_; }
    int limit() const { return limit_; }
    bool menuReady() const { return menuReady_; }
    bool menuShown() const { return menuShown_; }
    bool closeRequested() const { return closeRequested_; }

private:
    void Enter(State s, int limit);   // the inline "if (state != s) { limit = ..; state = s; counter = 0 }"

    State state_ = State::Boot;       // +0x610
    int counter_ = 0;                 // +0x618 (the original's +0x618 is incremented at the top of Tick)
    int limit_ = 10;                  // +0x61C
    bool menuShown_ = false;          // +0x344
    bool menuReady_ = false;          // DAT_00E5E281
    bool closeRequested_ = false;     // flags |= 1
    bool skipFrontEndDone_ = false;   // DAT_0104DB00
    std::uint32_t readyDeadlineMs_ = 0;   // +0x714
};

// ---- Tables --------------------------------------------------------------------------------------------------------

// WFrontEnd_SetupMenuItems 0x00693C80. The $command is stored at this + 0x348 + 0x20 * index.
struct MenuItem {
    const char* captionKey;   // localized with Localize()
    const char* command;
    bool onlyIfAddOnGate;     // created only when FUN_00541F60(..) is true; it is `param == 0`, so in practice always
};
extern const MenuItem kMenuItems[19];

// WFrontEnd_RegisterExternCallbacks 0x00692A90. The menu's Flash movie calls these by name.
struct ExternCallback {
    const char* name;
    enum class Action {
        AdjustSetting,   // arg = which setting, delta = +1 or -1; clamped to its range
        AdjustVolume,    // arg = audio channel (1 music, 2 sound), delta = +0.1 or -0.1
        PostEvent,       // arg = event id
        QuitGame,        // sets the main object's byte +6 (the Game_MainLoop exit flag)
        CloseDialog,     // closes one of the options dialogs
        Panel,           // options / quit panel flags (+0x710 mutex, +0x712, +0x713)
        Other,           // reads a Flash name or a save button, not decoded
    } action;
    int arg;
    int delta;
    bool onlyIfAddOnGate;
};
extern const ExternCallback kExternCallbacks[35];

// The four options the Flash movie steps up and down, with the range each is clamped to (the handlers at 0x68F2C0..0x68F3A0).
enum class Setting : int { Resolution = 0, Difficulty = 1, Blood = 2, Detail = 3 };
struct SettingRange { int min; int max; };
SettingRange RangeOf(Setting s);   // resolution 0..3, difficulty 0..2, blood 0..4, detail 0..4

// The paths the credits flow plays (WFrontEnd_Tick states 3 and 4, WFrontEnd_OnEvent 0x71D).
const char* FilmedCreditsPath(int qualityTier);      // tier < 2: the _low movie
const char* ExpackCreditsPath(int qualityTier, bool lowExists);
const char* CreditsPath(int qualityTier);

}  // namespace otm::frontend
