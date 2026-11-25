// The main menu (the WFrontEnd window): its state machine, its event handler and its two tables.
//
// From WFrontEnd_Tick (0x006921C0, the per-frame state machine), WFrontEnd_SetState (0x00690E40), WFrontEnd_OnEvent (0x00690F10),
// WFrontEnd_SetupMenuItems (0x00693C80, the 19 captions and $commands) and WFrontEnd_RegisterExternCallbacks (0x00692A90, the 35 callbacks the menu's
// Flash movie calls). Derivation, open questions and what was not read: docs/FRONTEND.md. Read from the decompile and the disassembly; nothing here
// has been compared with the running game.
//
// It owns no window, movie player or game: the caller passes in what it observed and applies the returned effects.

/** WFrontEnd +0x610. The names say what the state does; the originals are plain numbers. */
export const State = {
  /** waits for the frame counter to pass the limit (10 after construction), then shows the menu */
  Boot: 0,
  /** the menu is up; the background movie's volume follows the music volume */
  Menu: 1,
  /** waits for the current movie to end, then shows the menu again */
  ReturnToMenu: 2,
  /** when the current movie ends, plays the expansion credits and moves on to CreditsMain */
  CreditsExpack: 3,
  /** when the current movie ends, plays the main credits and moves on to ReturnToMenu */
  CreditsMain: 4,
  /** after 25 frames asks the window to close; ignores events meanwhile */
  Leaving: 5,
} as const;
export type State = (typeof State)[keyof typeof State];

/** EventManager ids the menu posts and handles. */
export const Ev = {
  NewGame: 0x515,
  Sandbox: 0x5b5,
  OpenGame: 0x5dd,
  /** handled like OpenGame; who posts it is not known */
  OpenGameAlt: 0x605,
  TrailerEditor: 0x62d,
  Credits: 0x71d,
  Tutorial: 0x795,
  Online: 0x7bd,
  Resume: 0x7e5,
  AddOnQuickStart: 0x8fd,
} as const;

/** What the caller must do, in the order the original ran it. */
export type Effect =
  /** Audio_SetState(arg, frontEnd, 1) (FUN_004F98F0 on the audio manager) */
  | { kind: "pushAudioState"; arg: number }
  /** Audio_RemoveState(arg, frontEnd, 1) (FUN_004F9B70) */
  | { kind: "popAudioState"; arg: number }
  /** the first time the menu is shown: builds the menu (FUN_004237F0, FUN_00424130(2,0,0), ...) */
  | { kind: "showMenu" }
  /** show or hide the background movie (FUN_006B9380; 0 shows, 1 hides) */
  | { kind: "backgroundVisible"; arg: 0 | 1 }
  | { kind: "backgroundAlpha"; value: number }
  /** the movie player is opened on this path and played */
  | { kind: "playMovie"; text: string }
  /** WFrontEnd_StartMenuReadyTimer: the menu becomes ready 750 ms later */
  | { kind: "startMenuReadyTimer" }
  /** DAT_00E5E281 */
  | { kind: "setMenuReady"; arg: 0 | 1 }
  | { kind: "postEvent"; arg: number }
  /** mode 0 new game, 1 sandbox, 3 add-on quick start (WProfileScreen_Create 0x6E3200) */
  | { kind: "openProfileScreen"; arg: number }
  /** the Basics tutorial path (also used by New Game when "Played Basics" is false) */
  | { kind: "startTutorial" }
  /** DAT_0104A982 = 1 */
  | { kind: "resumeGame" }
  | { kind: "openLoadScreen" }
  | { kind: "openOnlineScreen" }
  | { kind: "openTrailerEditor" };

export interface TickInput {
  /** DAT_0105BE08 */
  qualityTier?: number;
  /** no movie player, or the player reports the movie finished (vtable +0x28); default true */
  movieFinishedOrNone?: boolean;
  /** FUN_009D3660: data/credits/credits_expack_low.wmv can be opened */
  expackLowExists?: boolean;
  /** the background movie object exists and +0x6E5 is set */
  backgroundPulses?: boolean;
  /** channel 1, FUN_004F30A0; default 1 */
  musicVolume?: number;
  /** Timer_GetMilliseconds */
  nowMs?: number;
  /** the "Skip Front End" config int: 1 starts a sandbox, 2 a new game, once */
  skipFrontEndSetting?: number;
}

export interface EventInput {
  qualityTier?: number;
  /** +0x60C: there is a game to resume */
  resumeAvailable?: boolean;
  /** config "Played Basics" */
  playedBasics?: boolean;
  /** config "CompletedGame" */
  completedGame?: boolean;
  expackLowExists?: boolean;
  /** the movie player object (+0x640) exists; default true */
  movieHostPresent?: boolean;
}

const movie = (text: string): Effect => ({ kind: "playMovie", text });
const alpha = (value: number): Effect => ({ kind: "backgroundAlpha", value });

export class FrontEnd {
  /** +0x610 */
  state: State = State.Boot;
  /** +0x618, incremented at the top of tick */
  frameCounter = 0;
  /** +0x61C */
  limit = 10;
  /** +0x344 */
  menuShown = false;
  /** DAT_00E5E281 */
  menuReady = false;
  /** the window's flags |= 1 */
  closeRequested = false;
  /** DAT_0104DB00 */
  private skipFrontEndDone = false;
  /** +0x714 */
  private readyDeadlineMs = 0;

  /** The inline sequence the original repeats everywhere: if (state != s) { limit = ..; state = s; counter = 0; } */
  private enter(s: State, limit: number): void {
    if (this.state === s) return;
    this.limit = limit;
    this.state = s;
    this.frameCounter = 0;
  }

  /** Does nothing if the state is unchanged. orig: 0x00690E40 */
  setState(s: State): Effect[] {
    const fx: Effect[] = [];
    if (s === this.state) return fx;
    if (s === State.Boot) this.limit = 1;
    else if (s === State.Menu) {
      fx.push({ kind: "backgroundVisible", arg: 0 }); // FUN_006B9380(0), when a background movie object exists
      if (!this.menuShown) {
        this.menuShown = true;
        fx.push({ kind: "showMenu" });
      }
      // the limit is left as it was
    } else if (s === State.Leaving) this.limit = 25;
    else this.limit = -1;
    this.state = s;
    this.frameCounter = 0;
    return fx;
  }

  /** The counter is incremented first, then the state's rule runs. orig: 0x006921C0 */
  tick(input: TickInput = {}): Effect[] {
    const tier = input.qualityTier ?? 0;
    const movieDone = input.movieFinishedOrNone ?? true;
    const now = input.nowMs ?? 0;
    const fx: Effect[] = [];
    this.frameCounter++;
    switch (this.state) {
      case State.Boot:
        if (this.limit < this.frameCounter) {
          if (tier < 2) fx.push({ kind: "pushAudioState", arg: 4 });
          fx.push(...this.setState(State.Menu));
        }
        break;
      case State.Menu:
        if (input.backgroundPulses) fx.push(alpha((input.musicVolume ?? 1) * 0.45 + 0.45));
        break;
      case State.ReturnToMenu:
        if (movieDone) {
          fx.push({ kind: "popAudioState", arg: 0 });
          fx.push(...this.setState(State.Menu));
          fx.push({ kind: "backgroundVisible", arg: 0 }, { kind: "startMenuReadyTimer" });
          this.menuReady = false;
          this.readyDeadlineMs = (now + 750) >>> 0;
        }
        break;
      case State.CreditsExpack:
      case State.CreditsMain:
        if (movieDone) {
          let next: State;
          if (this.state === State.CreditsExpack) {
            fx.push(movie(expackCreditsPath(tier, !!input.expackLowExists)));
            next = State.CreditsMain;
          } else {
            fx.push(movie(creditsPath(tier)));
            next = State.ReturnToMenu;
          }
          this.enter(next, -1);
          fx.push({ kind: "backgroundVisible", arg: 1 }, alpha(0), { kind: "setMenuReady", arg: 0 });
          this.menuReady = false;
        }
        break;
      case State.Leaving:
        if (this.limit <= this.frameCounter) this.closeRequested = true;
        break;
    }
    // "Skip Front End" 1 or 2: post a sandbox or a new game once, on the first tick (DAT_0104DB00).
    const skip = input.skipFrontEndSetting ?? 0;
    if (skip !== 0 && !this.skipFrontEndDone) {
      if (skip === 1) fx.push({ kind: "postEvent", arg: Ev.Sandbox });
      else if (skip === 2) fx.push({ kind: "postEvent", arg: Ev.NewGame });
    }
    this.skipFrontEndDone = true;
    // the menu becomes ready once the 750 ms timer passes
    if (this.readyDeadlineMs !== 0 && this.readyDeadlineMs < now) {
      this.menuReady = true;
      this.readyDeadlineMs = 0;
      fx.push({ kind: "setMenuReady", arg: 1 });
    }
    return fx;
  }

  /** The effects of one event; events that are not handled return nothing. orig: 0x00690F10 */
  onEvent(id: number, input: EventInput = {}): Effect[] {
    const fx: Effect[] = [];
    if (this.state === State.Leaving) return fx; // events are ignored while the front end is closing
    const tier = input.qualityTier ?? 0;
    switch (id) {
      case Ev.Resume:
        if (input.resumeAvailable) {
          this.enter(State.Leaving, 25);
          fx.push({ kind: "resumeGame" });
        }
        break;
      case Ev.NewGame:
        if (input.playedBasics) {
          this.enter(State.Leaving, 25);
          fx.push({ kind: "openProfileScreen", arg: 0 });
        } else {
          // New Game before the Basics tutorial has been played runs the tutorial instead.
          fx.push({ kind: "backgroundVisible", arg: 1 });
          this.enter(State.Leaving, 25);
          fx.push({ kind: "startTutorial" });
        }
        break;
      case Ev.Sandbox:
        this.enter(State.Leaving, 25);
        fx.push({ kind: "openProfileScreen", arg: 1 });
        break;
      case Ev.AddOnQuickStart:
        this.enter(State.Leaving, 25);
        fx.push({ kind: "openProfileScreen", arg: 3 });
        break;
      case Ev.Tutorial:
        this.enter(State.Leaving, 25);
        fx.push({ kind: "backgroundVisible", arg: 1 }, { kind: "startTutorial" });
        break;
      case Ev.OpenGame:
      case Ev.OpenGameAlt:
        fx.push({ kind: "openLoadScreen" });
        break;
      case Ev.TrailerEditor:
        fx.push({ kind: "openTrailerEditor" }, { kind: "backgroundVisible", arg: 1 });
        break;
      case Ev.Online:
        fx.push({ kind: "openOnlineScreen" }, { kind: "backgroundVisible", arg: 1 });
        break;
      case Ev.Credits:
        if (input.movieHostPresent === false) break;
        fx.push({ kind: "backgroundVisible", arg: 1 });
        if (input.completedGame) {
          fx.push(movie(filmedCreditsPath(tier)));
          this.enter(State.CreditsExpack, -1);
        } else {
          fx.push(movie(expackCreditsPath(tier, !!input.expackLowExists)));
          this.enter(State.CreditsMain, -1);
        }
        fx.push(alpha(0));
        break;
      default:
        break; // the Flash panel events (0x80D, 0x835, 0x85D, 0x885, 0x8AD, 0x8D5) are not decoded
    }
    return fx;
  }
}

// ---- Paths: the credits flow (WFrontEnd_Tick states 3 and 4, WFrontEnd_OnEvent 0x71D) ----

/** tier < 2: the _low movie */
export function filmedCreditsPath(tier: number): string {
  return tier < 2 ? "data/credits/filmedcredits_low.wmv" : "data/credits/filmedcredits.wmv";
}
export function expackCreditsPath(tier: number, lowExists: boolean): string {
  return tier < 2 && lowExists ? "data/credits/credits_expack_low.wmv" : "data/credits/credits_expack.wmv";
}
export function creditsPath(tier: number): string {
  return tier < 2 ? "data/credits/credits_low.wmv" : "data/credits/credits.wmv";
}

// ---- Tables ----

/** WFrontEnd_SetupMenuItems. The $command is stored at this + 0x348 + 0x20 * index. onlyIfAddOnGate: created only when FUN_00541F60(..) is true; it is
 * `param == 0`, so in practice always. */
export interface MenuItem {
  captionKey: string;
  command: string;
  onlyIfAddOnGate: boolean;
}

export const MENU_ITEMS: readonly MenuItem[] = [
  ["FRONTEND_RESUME", "$resume"], ["FRONTEND_GAME", "$game"], ["FRONTEND_LOAD", "$load"], ["FRONTEND_SAVE", "$save"], ["FRONTEND_NEW", "$newgame"],
  ["FRONTEND_TUTORIAL", "$tutorial"], ["FRONTEND_SANDBOX", "$sandbox"], ["FRONTEND_ONLINE", "$online"], ["FRONTEND_OPTIONS", "$options"],
  ["FRONTEND_MOVIEPLAYER", "$movies"], ["FRONTEND_VIDEOOPTION", "$videooption"], ["FRONTEND_AUDIOOPTION", "$audiooption"],
  ["FRONTEND_GAMEOPTION", "$gameoption"], ["FRONTEND_ONLINEOPTION", "$onlineoption"], ["FRONTEND_CREDITS", "$credits"], ["FRONTEND_QUIT", "$quit"],
  ["FRONTEND_QUITQUESTION", "$quitquestion"], ["FRONTEND_QUICKSTART", "$addon1quickstart", true], ["FRONTEND_CONTINUE", "$continue", true],
].map(([captionKey, command, gate]) => ({ captionKey: captionKey as string, command: command as string, onlyIfAddOnGate: gate === true }));

/** The four options the Flash movie steps up and down (the handlers at 0x68F2C0..0x68F3A0). */
export const Setting = { Resolution: 0, Difficulty: 1, Blood: 2, Detail: 3 } as const;
export type Setting = (typeof Setting)[keyof typeof Setting];

/** The range each setting is clamped to: resolution 0..3 (+0x6EC), difficulty 0..2 (+0x694), blood 0..4 (+0x698), detail 0..4 (+0x6F0). */
export function rangeOf(s: Setting): { min: number; max: number } {
  return { min: 0, max: [3, 2, 4, 4][s] ?? 0 };
}

/**
 * WFrontEnd_RegisterExternCallbacks. The menu's Flash movie calls these by name.
 * adjustSetting: arg = the setting, delta +1 or -1, clamped to its range; adjustVolume: arg = the audio channel (1 music, 2 sound), delta +0.1 or -0.1;
 * postEvent: arg = the event; quitGame: sets the main object's byte +6 (the Game_MainLoop exit flag); closeDialog: one of the options dialogs; panel: the
 * options / quit panel flags (+0x710 mutex, +0x712, +0x713); other: reads a Flash name or a save button, not decoded.
 */
export interface ExternCallback {
  name: string;
  action: "adjustSetting" | "adjustVolume" | "postEvent" | "quitGame" | "closeDialog" | "panel" | "other";
  arg: number;
  delta: number;
  onlyIfAddOnGate: boolean;
}

const cb = (name: string, action: ExternCallback["action"], arg = 0, delta = 0, onlyIfAddOnGate = false): ExternCallback => ({ name, action, arg, delta, onlyIfAddOnGate });

export const EXTERN_CALLBACKS: readonly ExternCallback[] = [
  cb("ExternResIncrease", "adjustSetting", Setting.Resolution, +1), cb("ExternResDecrease", "adjustSetting", Setting.Resolution, -1),
  cb("ExternDiffIncrease", "adjustSetting", Setting.Difficulty, +1), cb("ExternDiffDecrease", "adjustSetting", Setting.Difficulty, -1),
  cb("ExternBloodIncrease", "adjustSetting", Setting.Blood, +1), cb("ExternBloodDecrease", "adjustSetting", Setting.Blood, -1),
  cb("ExternDetailIncrease", "adjustSetting", Setting.Detail, +1), cb("ExternDetailDecrease", "adjustSetting", Setting.Detail, -1),
  cb("ExternMusicVolUp", "adjustVolume", 1, +1), cb("ExternMusicVolDown", "adjustVolume", 1, -1),
  cb("ExternSoundVolUp", "adjustVolume", 2, +1), cb("ExternSoundVolDown", "adjustVolume", 2, -1),
  cb("ExternStartNewGame", "postEvent", Ev.NewGame), cb("ExternStartSandbox", "postEvent", Ev.Sandbox), cb("ExternQuitGame", "quitGame"),
  cb("ExternOpenGame", "postEvent", Ev.OpenGame), cb("cb_trailereditor", "postEvent", Ev.TrailerEditor), cb("ExternOnline", "postEvent", Ev.Online),
  cb("ExternCredits", "postEvent", Ev.Credits), cb("ExternTutorial", "postEvent", Ev.Tutorial), cb("ExternResume", "postEvent", Ev.Resume),
  cb("ExternGamebutOpen", "other"), // FUN_0068FEE0: "saveon", "savebutton"
  cb("ExternGamebutClosed", "other"), // FUN_0068FE10: "saveoff", "savebutton"
  cb("ExternSave", "other"), // 0x68FAD0, not read
  cb("ExternAudioClose", "closeDialog", 0), // FUN_006376D0
  cb("ExternVideoClose", "closeDialog", 1), // FUN_0081A420
  cb("ExternOnlineClose", "closeDialog", 2), // FUN_006BBE60
  cb("ExternGameplayClose", "closeDialog", 3), // FUN_00699510
  cb("ExternOptionsClickedOpen", "panel", 0, +1), cb("ExternOptionsClickedClose", "panel", 0, -1),
  cb("ExternQuitClickedOpen", "panel", 1, +1), cb("ExternQuitClickedClose", "panel", 1, -1), cb("ExternEnterMain", "panel", 2),
  cb("AddOn1Qstart", "postEvent", Ev.AddOnQuickStart, 0, true),
  cb("ExternContinue", "other", 0, 0, true), // FUN_00692530, not read
];
