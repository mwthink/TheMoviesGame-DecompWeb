# The main game loop

Status: read from the decompile, the disassembly and the boot traces (BOOT.md). Nothing here was observed per frame at runtime: the tracer only logs first
calls, so the *order within a tick* is the order in the code, not a measured one. Evidence is marked **[read]** (seen in the code), **[scan]** (found by scanning
the executable for call sites) or **[inferred]**.

## 1. Where it is

`Game_MainLoop` (0x447C30) is the loop. `WinMain` calls it after the intro (or straight away with "Skip Front End"), and it runs until the program exits.
Its body **[read]**:

```
main = new Game (0xCC bytes)  ->  Game_Constructor 0x4291C0  ->  Game_StartupSequence 0x4289E0 (BOOT.md)
while main[+6] == 0:                               # +6 is set by ExternQuitGame, or by a window close
    FUN_009B3890()                                 # engine update (FUN_009B3820, FUN_009B3380): not read
    for n = Timestep_NextTick(); n != 0; n--:      # 0 or 1 simulation ticks per pass
        Game_TickOneFrame()
    Game_Render()                                  # skipped if the state changed this frame
    if main[+6] != 0: break
    main[+6] = Game_PumpMessages()                 # PeekMessage loop; WM_CLOSE / WM_QUIT return 1
FUN_00423750(); free(main)                         # shutdown
```

`Timestep_NextTick` (0x566B10) is a **fixed timestep**: it adds `frame time * game speed (+0x38)` to an accumulator and returns 1 once the accumulator has
reached **0.1 s** (subtracting 0.1). So the simulation ticks at most once per pass, at 10 ticks per second of game-speed-scaled time, while rendering runs
every pass. A second accumulator at real time sets a flag every 0.1 s, and `+0x4C` holds the leftover fraction times 10, for rendering between ticks.

## 2. The state stack

The game object keeps a **stack of states**: a vector of 12-byte entries `{id, tick callback, render callback}` in a sub-object at `+0xAC` (begin `+0xB0`,
end `+0xB4`) **[read]**. `Game_PushState(id, tickFn, renderFn)` (0x424130, 31 call sites) pushes, `Game_PopState` (0x4237F0) pops, and both set the
**state-changed flag** (`+0x88` bit 0). `Game_TickOneFrame` clears that flag, switches on the id of the top entry, and every state function returns early if a
callback changed the state; `Game_Render` skips the frame when the flag is set.

The id selects the tick function **[read]**: 0 and the default `Game_TickActiveGameplay` (0x422B00) (state 0 first runs a transition check on `+0xC7`, and
takes the state-4 path if that byte is set); 1 `Game_TickState1`; 2 `Game_TickState2`; 3 `Game_TickPaused`; 4 `Game_TickState4`; 5 `Game_TickState5`.

Who pushes which id **[scan of the 31 call sites; the meaning is inferred from the pusher]**:

| id | pushed by | meaning |
|---|---|---|
| 0 | `Game_StartupSequence` (the base entry, three zero dwords) | normal gameplay: the world runs |
| 1 | about 25 window constructors: `ReleaseScreen`, `WFrontEnd_Constructor` (one path), the build and review screens, `WPauseMenu` (one path) | a full-screen UI mode |
| 2 | `WFrontEnd_SetState` (on first show), `WFrontEnd_Constructor` (one path), the `WProfileScreen` constructor (`FUN_006DCE30`) | menu-like screens |
| 3 | `WShotFiddler_Constructor` | editing a shot: the paused tick |
| 4 | `WLandscapeGUI_Constructor`, `FUN_0053C900` | landscape or lot editing |
| 5 | `WPauseMenu` (`FUN_006D8F90`) | the pause menu |

What distinguishes the tick functions **[read]**. Every state also ticks the window list (`WindowList_TickAll`), calls the top entry's tick callback, runs the window manager's
tick (every window's `Tick`), calls `FUN_0053CC60` when `FUN_00544030` is false, and ends with `SaveLoad_PumpRequests`:

| step | Active gameplay (0) | Paused (3) | UI only (1) | State 4 | Menu (2) and pause menu (5) |
|---|---|---|---|---|---|
| `GameClock_Update` | **yes** | yes | no | no | no |
| `Campaign_AdvanceYearIfDecadeElapsed` | **yes** | no | no | no | no |
| `SimObjectQueue_TickPending` | **yes** | yes | no | no | no |
| `GlobalStatRegistry_Get` + `FUN_008C88A0` | yes | no | no | yes (after State1) | no |
| `FUN_005474E0` | yes | no | no | no | no |
| `FUN_005474A0` first | no | no | no | yes | yes |
| `FUN_00566BF0` | yes | yes | no | no | no |
| deferred UI action (`+0xC5`, `FUN_006A44F0`) | yes | no | no | no | yes |
| the screen's own teardown check at the end | no | no | no | no | **yes**, see below |

State 4 is `Game_TickState1` followed by its own extras. So the clock and the simulation advance only in states 0 and 3 (whether the clock really moves in state 3 depends on
`GameClock_Update`, which was not read). In the UI states the loop still ticks the windows and pumps the save/load queue. After the state function, `Game_TickOneFrame` calls
`FUN_004FB1C0` on the audio manager (an update, inferred from the name pattern) and increments a frame counter (`this[0]`).

State 2 ends by testing `DAT_0104DAFC` (the front end) with `WFrontEnd_IsCloseRequested` and, if set, dropping a reference and destroying it; state 5 does the same for `DAT_0104DCF0` with
`FUN_006D7690` (`this+0x42C & 1`); that singleton is the pause menu **[inferred]**.

`SaveLoad_PumpRequests` (0x4B3AE0) ends every state. It handles the autosave timer (`autosave.jad`) and drains the event queue for three ids **[read]**:
`0x209` `MT_GAME_SAVE`, `0x231` `MT_GAME_LOAD`, `0x259` (load the quick-start save; posted by the profile screen's quick-start path). Other events are dispatched
elsewhere (not found).

## 3. From the main menu to a running game

```mermaid
sequenceDiagram
    participant U as Player
    participant M as Menu movie (frontend.mfl)
    participant F as WFrontEnd
    participant P as WProfileScreen
    participant G as Game loop
    Note over G: stack [0]. Game_StartupSequence creates WFrontEnd, which pushes its entry; first show makes the top state 2
    G->>F: Game_TickState2 every pass (menu)
    U->>M: click New Game
    M->>F: ExternStartNewGame() -> EventManager_PostEvent(0x515)
    F->>F: WFrontEnd_OnEvent: state 5 (Leaving, 25 frames)
    F->>P: WProfileScreen_Create(mode 0)  (pushes state 2 for itself)
    Note over G: stack [0, 2 menu, 2 profile]
    G->>F: 25 ticks later close bit set; Game_TickState2 sees FUN_0068F280, destroys WFrontEnd (Game_PopState)
    Note over G: stack [0, 2 profile]
    U->>P: types names, confirms
    P->>P: WProfileScreen_OnConfirm: CSandbox options, Campaign_Begin(year, x, tutorial)
    P->>G: window destructor -> Game_PopState
    Note over G: stack [0]
    G->>G: Game_TickActiveGameplay: GameClock_Update, SimObjectQueue_TickPending, ...
```

What is established **[read]**: the menu runs as state 2; each button calls an `Extern*` function in the movie's ActionScript, which posts an event; `WFrontEnd_OnEvent`
sends the front end into its 25-frame Leaving state and opens the profile screen; the profile screen pushes its own state-2 entry and its destructor pops one;
`Game_TickState2` destroys the front end when `WFrontEnd_IsCloseRequested` (the bit set in Leaving) is true; with the stack back to `[0]`, `Game_TickOneFrame` dispatches
to `Game_TickActiveGameplay`, which is the first state that advances `GameClock_Update`.

Other ways in **[read]**:
- **Continue** (`ExternContinue`) posts `0x231`, and `SaveLoad_PumpRequests` runs `Savegame_LoadAndRestoreGame`; the load-game screen posts the same id.
- **Add-on quick start** posts `0x259` from `FUN_006E1070` after checking the save file exists.
- **Tutorial**, and New Game before the Basics were played, skip the profile screen and run the same `Campaign_Begin` tutorial sequence directly.
- **Skip Front End** = 1 or 2: `WFrontEnd_Tick` posts the sandbox or new-game event on its first tick.

What is **not** known:
- **Who is in the studio on day one**: nobody, see NEW_GAME.md. The starting world is built by `Game_ConstructSystems` (about 45 steps, shared with loading a game) and a layout file chosen by `Campaign_Begin`
  (`data/savedefaults/<year>.ini`: the buildings and props); see NEW_GAME.md. There is no starting staff (no layout has `hired_staff`); the applicant pool is described in NEW_GAME.md section 7.
- Who dispatches events other than `0x209`, `0x231` and `0x259` to windows such as `WFrontEnd_OnEvent`, and on which pass.
- What `FUN_009B3890` (engine update) and the render functions `FUN_00423040`, `FUN_00423150`, `FUN_00423260` do.
- The meaning of `Game+7`, `+8`, `+9`, `+0xA`, `+0xB` (set to 1 after a `0x259` load) and `+0xC7`.

## 4. One step through the loop (state 0, a game is running)

One pass of `Game_MainLoop` **[read]**, when a tick is due:

1. Engine update (`FUN_009B3890`).
2. `Timestep_NextTick` returns 1: accumulator reduced by 0.1.
3. `Game_TickOneFrame`: clear the state-changed flag; `FUN_0053D440`, `FUN_0053C8C0`, `FUN_009A1560(0)`, `FUN_006A0020`; switch on the top state (0).
4. `Game_TickActiveGameplay`:
   1. clear `Game+7`; `FUN_009A1570`; get the window manager (`WindowManager_Get`); `FUN_0053C820` twice;
   2. **`GameClock_Update`**, then **`Campaign_AdvanceYearIfDecadeElapsed`**;
   3. `FUN_00544030` (a flag at `+0x4C0` and a value of 1.0 at `+0x4C4`); if false, `FUN_00554680`;
   4. **`SimObjectQueue_TickPending`**: the simulation step. The debugger hooks `TMRoom::Tick`, `CStaff::Tick`, `CStudioAI::Tick`, `TMBaseDesire::TickShared` and others, which are
      reached from here by virtual calls (not traceable statically);
   5. a singleton's virtual `+0xC` (`FUN_005EF380`), then `WindowList_TickAll`;
   6. if the state did not change: `GlobalStatRegistry_Get` and `FUN_008C88A0`, `FUN_00525DF0`, the top entry's tick callback, then the **window manager's tick** (every window's `Tick`,
      e.g. `WWindow::Tick`, `WInterface::Tick`, `WAdvMovieMaker::Tick`);
   7. a deferred UI action if `+0xC5` is set (`FUN_006A44F0`);
   8. if the state still did not change: `FUN_0053CC60`, `FUN_00566BF0`, `FUN_005474E0`, then **`SaveLoad_PumpRequests`** (autosave timer, save and load events).
5. Audio update, frame counter + 1.
6. `Game_Render`: pick the render function for the top state (id 0 and everything above 3 use `FUN_00423040`), which draws and calls the top entry's render callback.
7. If `main[+6]` is set, leave; otherwise `Game_PumpMessages` and loop.

The per-tick steps are in code order. The coverage data show which functions run in steady play (`docs/generated/steady_state.csv`, about 3,800), but not the order inside a frame.

## 5. How to check this

- Breakpoint or hook `Game_PushState` and `Game_PopState` (the debugger already hooks `Game_TickOneFrame`, `Game_TickState1/2/4/5`, `Game_TickPaused` and `Game_TickActiveGameplay`, so state changes
  can be logged with the id) and click through the menu: expect `[0]`, then 2 for the menu, 2 again for the profile screen, then back to `[0]`.
- Log the top state id in `Game_TickOneFrame` once per tick for a whole session: it should be 2 in the menu and 0 once the game runs, and 5 when the pause menu is open.
