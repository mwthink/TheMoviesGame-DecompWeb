// Walks the front end's state machine through the transitions WFrontEnd_Tick (0x006921C0) and WFrontEnd_OnEvent (0x00690F10) make.
// Derived from the decompile and the disassembly; not compared with the running game (docs/FRONTEND.md).
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "game/frontend/FrontEnd.hpp"

using namespace otm::frontend;
using Kind = Effect::Kind;

static int g_failures = 0;
static void Check(const char* what, bool ok) {
    if (!ok) { std::printf("FAIL %s\n", what); ++g_failures; }
}
static const Effect* Find(const std::vector<Effect>& fx, Kind k) {
    for (const Effect& e : fx) if (e.kind == k) return &e;
    return nullptr;
}
static bool Has(const std::vector<Effect>& fx, Kind k, int arg) {
    for (const Effect& e : fx) if (e.kind == k && e.arg == arg) return true;
    return false;
}

static void TickN(FrontEnd& f, int n, const TickInput& in) { for (int i = 0; i < n; ++i) f.Tick(in); }

int main() {
    // --- Boot: state 0, limit 10; the tick after the counter passes the limit shows the menu.
    {
        FrontEnd f; TickInput in;
        Check("starts in Boot", f.state() == State::Boot && f.limit() == 10 && f.frameCounter() == 0);
        TickN(f, 10, in);
        Check("still Boot at counter 10", f.state() == State::Boot && f.frameCounter() == 10);
        const auto fx = f.Tick(in);
        Check("menu after the limit", f.state() == State::Menu && f.menuShown());
        Check("tier 0 sets audio state 4", Has(fx, Kind::PushAudioState, 4));
        Check("the menu is built once", Find(fx, Kind::ShowMenu) != nullptr);
        Check("counter reset on entering the menu", f.frameCounter() == 0);
        Check("limit is kept by state 1", f.limit() == 10);
    }
    {
        FrontEnd f; TickInput in; in.qualityTier = 2;
        TickN(f, 11, in);
        Check("tier 2 does not set audio state 4", f.state() == State::Menu);
        FrontEnd g; TickInput low; low.qualityTier = 1; TickN(g, 10, low);
        Check("tier 1 pushes it", Has(g.Tick(low), Kind::PushAudioState, 4));
    }
    {
        FrontEnd f;
        const auto a = f.SetState(State::Boot);
        Check("SetState to the same state does nothing", a.empty() && f.limit() == 10);
        f.SetState(State::Menu);
        Check("state 1 shows the menu and keeps the limit", f.state() == State::Menu && f.limit() == 10);
        Check("showing the menu again does not rebuild it", Find(f.SetState(State::ReturnToMenu), Kind::ShowMenu) == nullptr);
        const auto back = f.SetState(State::Menu);
        Check("... even when re-entered", Find(back, Kind::ShowMenu) == nullptr && f.menuShown());
        f.SetState(State::Leaving);
        Check("state 5 has a limit of 25", f.limit() == 25);
        f.SetState(State::CreditsMain);
        Check("other states have no limit", f.limit() == -1);
    }

    // --- Menu: the background pulses with the music volume.
    {
        FrontEnd f; TickInput in; f.SetState(State::Menu);
        in.backgroundPulses = true; in.musicVolume = 1.0;
        const auto hi = f.Tick(in);
        Check("alpha at full volume", Find(hi, Kind::BackgroundAlpha) && Find(hi, Kind::BackgroundAlpha)->value > 0.8999 && Find(hi, Kind::BackgroundAlpha)->value < 0.9001);
        in.musicVolume = 0.0;
        Check("alpha at zero volume", Find(f.Tick(in), Kind::BackgroundAlpha)->value > 0.4499 && Find(f.Tick(in), Kind::BackgroundAlpha)->value < 0.4501);
        in.backgroundPulses = false;
        Check("no background, no alpha", Find(f.Tick(in), Kind::BackgroundAlpha) == nullptr);
    }

    // --- Events that leave the front end.
    {
        FrontEnd f; f.SetState(State::Menu); EventInput e; e.playedBasics = true;
        const auto fx = f.OnEvent(ev::kNewGame, e);
        Check("new game with the Basics played opens the profile screen in mode 0", Has(fx, Kind::OpenProfileScreen, 0) && f.state() == State::Leaving && f.limit() == 25);
        Check("events are ignored while leaving", f.OnEvent(ev::kSandbox, e).empty() && f.state() == State::Leaving);
        TickInput in;
        TickN(f, 24, in);
        Check("not closed after 24 frames", !f.closeRequested());
        f.Tick(in);
        Check("closed after 25", f.closeRequested());
    }
    {
        FrontEnd f; f.SetState(State::Menu); EventInput e; e.playedBasics = false;
        const auto fx = f.OnEvent(ev::kNewGame, e);
        Check("new game without the Basics runs the tutorial", Find(fx, Kind::StartTutorial) && !Find(fx, Kind::OpenProfileScreen) && f.state() == State::Leaving);
        Check("... and hides the background first", fx.size() >= 1 && fx[0].kind == Kind::BackgroundVisible && fx[0].arg == 1);
    }
    {
        FrontEnd f; EventInput e;
        Check("sandbox opens the profile screen in mode 1", Has(f.OnEvent(ev::kSandbox, e), Kind::OpenProfileScreen, 1));
        FrontEnd g;
        Check("add-on quick start opens it in mode 3", Has(g.OnEvent(ev::kAddOnQuickStart, e), Kind::OpenProfileScreen, 3));
        FrontEnd h;
        Check("tutorial", Find(h.OnEvent(ev::kTutorial, e), Kind::StartTutorial) && h.state() == State::Leaving);
        FrontEnd r1; e.resumeAvailable = false;
        Check("resume without a game does nothing", r1.OnEvent(ev::kResume, e).empty() && r1.state() == State::Boot);
        FrontEnd r2; e.resumeAvailable = true;
        Check("resume with a game", Find(r2.OnEvent(ev::kResume, e), Kind::ResumeGame) && r2.state() == State::Leaving);
    }
    {
        EventInput e;
        FrontEnd a;
        const auto fa = a.OnEvent(ev::kOpenGame, e);
        Check("open game keeps the state", Find(fa, Kind::OpenLoadScreen) && a.state() == State::Boot);
        FrontEnd b;
        Check("0x605 opens it too", Find(b.OnEvent(ev::kOpenGameAlt, e), Kind::OpenLoadScreen) != nullptr);
        FrontEnd c;
        const auto fc = c.OnEvent(ev::kOnline, e);
        Check("online opens its screen and hides the background", Find(fc, Kind::OpenOnlineScreen) && Has(fc, Kind::BackgroundVisible, 1) && c.state() == State::Boot);
        FrontEnd d;
        Check("trailer editor", Find(d.OnEvent(ev::kTrailerEditor, e), Kind::OpenTrailerEditor) != nullptr);
        FrontEnd u;
        Check("unknown events do nothing", u.OnEvent(0x80D, e).empty() && u.OnEvent(0x1234, e).empty());
    }

    // --- Credits: filmed credits (if the game was completed) -> expansion credits -> main credits -> back to the menu.
    {
        FrontEnd f; f.SetState(State::Menu);
        EventInput e; e.completedGame = true; e.qualityTier = 0; e.expackLowExists = true;
        const auto fx = f.OnEvent(ev::kCredits, e);
        Check("completed: filmed credits first, tier 0 uses _low", Find(fx, Kind::PlayMovie) && Find(fx, Kind::PlayMovie)->text == "data/credits/filmedcredits_low.wmv");
        Check("... state 3, no limit", f.state() == State::CreditsExpack && f.limit() == -1 && f.frameCounter() == 0);
        TickInput in; in.qualityTier = 0; in.expackLowExists = true; in.movieFinishedOrNone = false;
        Check("a playing movie holds the state", Find(f.Tick(in), Kind::PlayMovie) == nullptr && f.state() == State::CreditsExpack);
        in.movieFinishedOrNone = true;
        const auto t3 = f.Tick(in);
        Check("then the expansion credits", Find(t3, Kind::PlayMovie)->text == "data/credits/credits_expack_low.wmv" && f.state() == State::CreditsMain);
        Check("... with the background hidden and not ready", Has(t3, Kind::BackgroundVisible, 1) && !f.menuReady());
        const auto t4 = f.Tick(in);
        Check("then the main credits", Find(t4, Kind::PlayMovie)->text == "data/credits/credits_low.wmv" && f.state() == State::ReturnToMenu);
        const auto t2 = f.Tick(in);
        Check("then back to the menu", f.state() == State::Menu && Has(t2, Kind::PopAudioState, 0) && Find(t2, Kind::StartMenuReadyTimer));
        in.nowMs = 1000; f.Tick(in);
        Check("ready 750 ms after the menu returns (timer started at nowMs 0)", f.menuReady());
    }
    {
        FrontEnd f; f.SetState(State::Menu);
        EventInput e; e.completedGame = false; e.qualityTier = 2;
        const auto fx = f.OnEvent(ev::kCredits, e);
        Check("not completed: starts with the expansion credits (state 4)", Find(fx, Kind::PlayMovie)->text == "data/credits/credits_expack.wmv" && f.state() == State::CreditsMain);
        TickInput in; in.qualityTier = 2;
        Check("tier 2 uses the full-size main credits", Find(f.Tick(in), Kind::PlayMovie)->text == "data/credits/credits.wmv");
        FrontEnd g; g.SetState(State::Menu); EventInput lo; lo.qualityTier = 1; lo.expackLowExists = false;
        Check("tier 1 without the _low file falls back to the full one", Find(g.OnEvent(ev::kCredits, lo), Kind::PlayMovie)->text == "data/credits/credits_expack.wmv");
        FrontEnd h; EventInput none; none.movieHostPresent = false;
        Check("no movie player, no credits", h.OnEvent(ev::kCredits, none).empty() && h.state() == State::Boot);
    }
    Check("paths: filmed", std::strcmp(FilmedCreditsPath(1), "data/credits/filmedcredits_low.wmv") == 0 && std::strcmp(FilmedCreditsPath(2), "data/credits/filmedcredits.wmv") == 0);

    // --- "Skip Front End": 1 posts a sandbox, 2 a new game, once, on the first tick.
    {
        FrontEnd f; TickInput in; in.skipFrontEndSetting = 1;
        Check("skip 1 posts the sandbox event", Has(f.Tick(in), Kind::PostEvent, ev::kSandbox));
        Check("... only once", Find(f.Tick(in), Kind::PostEvent) == nullptr);
        FrontEnd g; TickInput two; two.skipFrontEndSetting = 2;
        Check("skip 2 posts the new-game event", Has(g.Tick(two), Kind::PostEvent, ev::kNewGame));
        FrontEnd h; TickInput none;
        h.Tick(none);
        none.skipFrontEndSetting = 1;
        Check("a skip setting that appears later is too late", Find(h.Tick(none), Kind::PostEvent) == nullptr);
        FrontEnd i; TickInput three; three.skipFrontEndSetting = 3;
        Check("other values post nothing", Find(i.Tick(three), Kind::PostEvent) == nullptr);
    }

    // --- Tables.
    Check("19 menu items, resume first", std::strcmp(kMenuItems[0].captionKey, "FRONTEND_RESUME") == 0 && std::strcmp(kMenuItems[0].command, "$resume") == 0);
    Check("the last two items are the gated ones", kMenuItems[17].onlyIfAddOnGate && kMenuItems[18].onlyIfAddOnGate && !kMenuItems[16].onlyIfAddOnGate);
    Check("items are paired $command / FRONTEND_ key", std::strcmp(kMenuItems[4].captionKey, "FRONTEND_NEW") == 0 && std::strcmp(kMenuItems[4].command, "$newgame") == 0);
    {
        int gated = 0, posts = 0;
        for (const ExternCallback& c : kExternCallbacks) { gated += c.onlyIfAddOnGate; posts += c.action == ExternCallback::Action::PostEvent; }
        Check("35 callbacks, 2 gated", gated == 2);
        Check("9 event-posting callbacks (quit sets a flag instead)", posts == 9);
        Check("first is ExternResIncrease", std::strcmp(kExternCallbacks[0].name, "ExternResIncrease") == 0);
        Check("last is ExternContinue", std::strcmp(kExternCallbacks[34].name, "ExternContinue") == 0 && kExternCallbacks[34].onlyIfAddOnGate);
        bool newGame = false, resume = false;
        for (const ExternCallback& c : kExternCallbacks) {
            if (!std::strcmp(c.name, "ExternStartNewGame")) newGame = c.arg == ev::kNewGame;
            if (!std::strcmp(c.name, "ExternResume")) resume = c.arg == ev::kResume;
        }
        Check("callbacks post the right ids", newGame && resume);
    }
    Check("setting ranges", RangeOf(Setting::Resolution).max == 3 && RangeOf(Setting::Difficulty).max == 2 && RangeOf(Setting::Blood).max == 4 && RangeOf(Setting::Detail).max == 4 && RangeOf(Setting::Detail).min == 0);

    if (g_failures == 0) std::printf("front_end_test: OK\n");
    return g_failures == 0 ? 0 : 1;
}
