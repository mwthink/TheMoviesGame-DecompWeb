// The start of the game: from WinMain's fork to the end of the intro splash screens, after which the game proper (Game_MainLoop, which hosts the
// WFrontEnd main menu) takes over.
//
// From WinMain (0x00542B20, the fork: ShouldSkipFrontEnd() || LH_MasterGameLoop() == 0 -> Game_MainLoop()), ShouldSkipFrontEnd (0x004EF580, config int
// "Skip Front End" != 0), the GameStateManager constructor (0x0045E220: "Open Count" and the quality tier), UpdateIntroSplashScreens (0x0045E3F0, the
// per-frame state machine), its state entry (0x0045E2F0) and LH_MasterGameLoop (0x0045E720). Derivation and open questions: docs/BOOT.md.
//
// Only the decision logic: it owns no window, renderer, clock or movie player. The caller feeds it the time and what the platform observed, and draws
// whatever current() says.

/** GameStateManager +0x04. 5 is the Chinese legal notice, reachable only from Start. */
export const IntroState = { Start: 0, Lionhead: 1, Activision: 2, Intel: 3, Ati: 4, LegalNotice: 5, Done: 6 } as const;
export type IntroState = (typeof IntroState)[keyof typeof IntroState];

/** What the platform should be showing. path is null for the animated Lionhead logo (LogoScreen_Initialize 0x009ECDA0) and for nothing. */
export interface Presentation {
  kind: "none" | "image" | "logoScreen" | "movie";
  path: string | null;
}

export interface IntroConfig {
  /** GameStateManager +0x16 = (DAT_0105be08 == 0): the lowest quality tier shows still images instead of the logo animation and the Activision video. */
  imageMode: boolean;
  /** GameStateManager +0x15 = (Open Count > 1): the Intel and ATI splashes may be skipped only from the second launch on. */
  skippableVendorSplashes: boolean;
  /** FUN_009B4250() == 0xD at state 0: show legal/chineselegal.jpg first (12 s), then carry on as normal. */
  legalNoticeFirst: boolean;
  /** each still image */
  splashMs: number;
  legalNoticeMs: number;
}

/** DAT_0105be08 is the quality tier (0 = lowest); openCount is the registry "Open Count" read when the manager is built. */
export function makeIntroConfig(qualityTier: number, openCount: number, legalNoticeFirst: boolean): IntroConfig {
  return { imageMode: qualityTier === 0, skippableVendorSplashes: openCount > 1, legalNoticeFirst, splashMs: 3000, legalNoticeMs: 12000 };
}

/** What the platform observed this frame. */
export interface IntroInput {
  /** GetTickCount() */
  nowMs: number;
  /** FUN_009EC720: Esc or Space held with the game window in front, or the fade reached 400 */
  logoScreenDone?: boolean;
  /** the Activision video finished (or there is no player) */
  movieDone?: boolean;
}

export interface SkipKeys {
  windowInFront: boolean;
  esc?: boolean;
  space?: boolean;
  enter?: boolean;
}

const NONE: Presentation = { kind: "none", path: null };
const LIONHEAD_IMAGE: Presentation = { kind: "image", path: "ui/lionhead_splash.dds" };
const LOGO_SCREEN: Presentation = { kind: "logoScreen", path: null };
const ACTIVISION_IMAGE: Presentation = { kind: "image", path: "ui/activision_screen.dds" };
const ACTIVISION_MOVIE: Presentation = { kind: "movie", path: "data/intro/atvi_logo.wmv" };
const INTEL_IMAGE: Presentation = { kind: "image", path: "ui/intel_splash.dds" };
const ATI_IMAGE: Presentation = { kind: "image", path: "ui/ati_splash.dds" };
const LEGAL_IMAGE: Presentation = { kind: "image", path: "legal/chineselegal.jpg" };

export class IntroSequence {
  private readonly cfg: IntroConfig;
  private stateValue: IntroState = IntroState.Start;
  private present: Presentation = NONE;
  /** GameStateManager +0x08 */
  private deadlineMs = 0;
  /** GameStateManager +0x14 */
  private skip = false;
  /** DAT_00F88F3C */
  private skipKeyLatch = false;

  constructor(config: IntroConfig) {
    this.cfg = config;
  }

  /** GameStateManager +0x14: the user asked to skip the current screen. Cleared whenever the state changes. */
  requestSkip(): void {
    this.skip = true;
  }

  /**
   * Input_CheckGlobalShortcuts (0x0045DF30), a method of the intro manager called once per frame before the update (the Ghidra name is misleading;
   * renames.csv calls it CIntroScreenManager_PollSkipKeys). It polls GetAsyncKeyState. A skip is requested when the game window is in front and Esc,
   * Space or Enter is down, edge-triggered by a latch (the global DAT_00F88F3C): a key that stays down requests one skip, and the latch clears only on a
   * frame where none is down in the foreground window (a window that is not in front clears it too). The latch is per object here, global there.
   * orig: 0x0045DF30
   */
  pollSkipKeys(keys: SkipKeys): void {
    const held = keys.windowInFront && !!(keys.esc || keys.space || keys.enter);
    if (held) {
      if (!this.skipKeyLatch) {
        this.skip = true;
        this.skipKeyLatch = true;
      }
    } else this.skipKeyLatch = false;
  }

  /** One frame of UpdateIntroSplashScreens. Returns true once the sequence is complete (state 6). orig: 0x0045E3F0 */
  update(input: IntroInput): boolean {
    const now = input.nowMs >>> 0;
    switch (this.stateValue) {
      case IntroState.Start:
        if (this.cfg.legalNoticeFirst) this.enterLegalNotice(now);
        else this.enterLionhead(now);
        break;
      case IntroState.Lionhead:
        if (this.cfg.imageMode) {
          if (this.skip || this.timedOut(now)) this.enterActivision(now);
        } else if (input.logoScreenDone) this.enterActivision(now);
        break;
      case IntroState.Activision:
        if (this.cfg.imageMode) {
          if (this.skip || this.timedOut(now)) this.enterIntel(now);
        } else if (input.movieDone) this.enterIntel(now); // the video stops on a skip request (wantsMovieSkip) and then reports done
        break;
      case IntroState.Intel:
        // skippable only from the second launch on; otherwise the full 3 s
        if ((this.skip && this.cfg.skippableVendorSplashes) || this.timedOut(now)) this.enter(IntroState.Ati, ATI_IMAGE, now, this.cfg.splashMs);
        break;
      case IntroState.Ati:
        if ((this.skip && this.cfg.skippableVendorSplashes) || this.timedOut(now)) {
          this.skip = false;
          this.stateValue = IntroState.Done;
          this.present = NONE;
        }
        break;
      case IntroState.LegalNotice:
        if (this.skip || this.timedOut(now)) this.enterLionhead(now);
        break;
      case IntroState.Done:
        break;
    }
    return this.done;
  }

  get state(): IntroState {
    return this.stateValue;
  }

  get done(): boolean {
    return this.stateValue === IntroState.Done;
  }

  current(): Presentation {
    return this.present;
  }

  /** True while the Activision video is playing and a skip is pending: the caller should stop the movie (vtable +0x1C). */
  get wantsMovieSkip(): boolean {
    return this.stateValue === IntroState.Activision && !this.cfg.imageMode && this.skip;
  }

  /** Every state entry clears the skip flag (the original writes +0x14 = 0 in each case), then shows the new screen. */
  private enter(next: IntroState, p: Presentation, nowMs: number, durationMs: number): void {
    this.skip = false;
    this.stateValue = next;
    this.present = p;
    this.deadlineMs = (nowMs + durationMs) >>> 0;
  }

  /** Image mode: the still for 3 s. Otherwise the animated logo, which ends by itself (no deadline is set). */
  private enterLionhead(now: number): void {
    if (this.cfg.imageMode) this.enter(IntroState.Lionhead, LIONHEAD_IMAGE, now, this.cfg.splashMs);
    else this.enter(IntroState.Lionhead, LOGO_SCREEN, now, 0);
  }

  private enterActivision(now: number): void {
    if (this.cfg.imageMode) this.enter(IntroState.Activision, ACTIVISION_IMAGE, now, this.cfg.splashMs);
    else this.enter(IntroState.Activision, ACTIVISION_MOVIE, now, 0);
  }

  private enterIntel(now: number): void {
    this.enter(IntroState.Intel, INTEL_IMAGE, now, this.cfg.splashMs);
  }

  private enterLegalNotice(now: number): void {
    this.enter(IntroState.LegalNotice, LEGAL_IMAGE, now, this.cfg.legalNoticeMs);
  }

  /** unsigned, like the original */
  private timedOut(now: number): boolean {
    return this.deadlineMs <= now;
  }
}

/**
 * What LH_MasterGameLoop does with a message pulled off the queue: WM_KILLFOCUS (0x08) and WM_SYSKEYUP (0x105) are dropped, WM_CLOSE (0x10) and
 * WM_QUIT (0x12) end the loop (consumed, not re-posted), the rest is translated and dispatched.
 */
export function classifyPumpMessage(message: number): "dispatch" | "drop" | "quit" {
  if (message === 0x08 || message === 0x105) return "drop";
  if (message === 0x10 || message === 0x12) return "quit";
  return "dispatch";
}

/** WinMain: the "Skip Front End" config int (default 0) selects the path: the intro first (then nextAfterIntro decides), or straight to Game_MainLoop. */
export function chooseBootPath(skipFrontEndSetting: number): "introThenGameLoop" | "gameLoopOnly" {
  return skipFrontEndSetting !== 0 ? "gameLoopOnly" : "introThenGameLoop";
}

/**
 * WinMain tests `LH_MasterGameLoop() == 0` to decide whether to run Game_MainLoop. Ghidra's return value is unreadable, but two runs show it: finishing
 * the intro goes on to Game_MainLoop (boot1), and closing the window mid-intro goes straight to WinMain's shutdown tail with Game_MainLoop never called
 * (close1). So "finished" returns 0 and "windowClosed" nonzero. (Closing at the first splash, in the logo-animation or movie variants, or with the
 * window already closed, is unobserved.)
 */
export function nextAfterIntro(outcome: "finished" | "windowClosed"): "gameLoop" | "shutdown" {
  return outcome === "finished" ? "gameLoop" : "shutdown";
}
