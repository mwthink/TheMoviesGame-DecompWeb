import "./style.css";
import type { Screen } from "./screens/Screen.ts";
import { SplashScreen } from "./screens/SplashScreen.ts";
import { MainMenuScreen } from "./screens/MainMenuScreen.ts";
import { GameView } from "./screens/GameView.ts";
import { LoadingGalleryScreen } from "./screens/LoadingGalleryScreen.ts";
import { CharacterViewerScreen } from "./screens/CharacterViewerScreen.ts";
import { OptionsScreen } from "./screens/OptionsScreen.ts";
import { SettingsStore } from "./settings/Settings.ts";
import { ProfileScreen } from "./screens/ProfileScreen.ts";
import { LoadGameScreen } from "./screens/LoadGameScreen.ts";
import { LoadingScreen, type LoadTask } from "./screens/LoadingScreen.ts";
import type { WorldData } from "./world/WorldData.ts";
import { AudioManager } from "./audio/AudioManager.ts";
import { calendarDate } from "./sim/core/GameClock.ts";

type ScreenId = "splash" | "menu" | "load" | "profile" | "loading" | "game" | "gallery" | "options" | "viewer";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const container = document.getElementById("screens") as HTMLElement;

let current: Screen | null = null;

function present(id: ScreenId, screen: Screen): void {
  current?.exit();
  current = screen;
  document.body.dataset.screen = id;
  syncAudio(id);
  current.enter();
}

function show(id: ScreenId): void {
  present(id, screens[id]());
}

/**
 * Run a world load behind the loading screen. The game view is built under the overlay and the overlay goes only once the scene
 * is compiled and has drawn a frame, so the player never sees the blank canvas that is still compiling shaders.
 */
function loadWorld(task: LoadTask<WorldData>): void {
  const loading: LoadingScreen<WorldData> = new LoadingScreen(container, async (progress) => {
    const world = await task(progress);
    progress.report(null, "Building the scene");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); // let that label paint before the build blocks
    return world;
  }, (world) => {
    gameView.world = world;
    current = gameView;
    document.body.dataset.screen = "game";
    gameView.enter();
    audio.newGameLoaded();
    // the loading music runs until the loading screen is gone, then the radio (already holding its place under it) comes back
    void gameView.ready.then(() => { loading.exit(); syncAudio("game"); });
  }, () => show("load"));
  present("loading", loading);
}

const settings = new SettingsStore(typeof localStorage === "undefined" ? null : localStorage);

// Audio: each screen holds the audio states the original's matching window sets (docs/AUDIO.md, "Audio states"). Music files are read from the dev server's
// local files; a build without them stays silent.
const audio = new AudioManager(settings, (path) => (import.meta.env.DEV ? `/__local/audio/${path.split("/").map(encodeURIComponent).join("/")}` : null));
// The radio plays the music of the game's year; a studio on its first day is a new game, which opens with the tracks flagged to play first.
audio.game = {
  year: () => calendarDate(gameView.gameDate).year,
  date: () => gameView.gameDate,
  focusY: () => gameView.focusY,
  events: () => gameView.world?.timelineEvents ?? [],
  newGame: () => gameView.startDate < 1920 * 365 + 1,
};
/** The (state, owner) pairs each screen holds, in the order the original sets them: a game's radio goes in before the loading music that covers it. */
const AUDIO_FOR: Record<ScreenId, ReadonlyArray<readonly [number, string]>> = {
  // Deviation: the original stops the splash music (state 6) when the splash ends and plays the front end's own soundtrack (state 4, a WMA video track a browser
  // cannot play, docs/AUDIO.md). Here the same pair stays held through the menu screens, so the intro music carries on and loops until a game starts loading.
  splash: [[6, "intro"]],
  menu: [[6, "intro"]], load: [[6, "intro"]], profile: [[6, "intro"]], options: [[6, "intro"]], gallery: [[6, "intro"]], viewer: [[6, "intro"]],
  loading: [[2, "game"], [1, "loading"]],
  game: [[2, "game"]],
};
let heldAudio: ReadonlyArray<readonly [number, string]> = [];
function syncAudio(id: ScreenId): void {
  const want = AUDIO_FOR[id];
  const has = (list: ReadonlyArray<readonly [number, string]>, [state, owner]: readonly [number, string]) => list.some(([s, o]) => s === state && o === owner);
  for (const held of [...heldAudio].reverse()) if (!has(want, held)) audio.removeState(held[0], held[1]);
  for (const w of want) if (!has(heldAudio, w)) audio.setState(w[0], w[1]);
  heldAudio = want;
}

// Screens are built on demand so each visit starts fresh. GameView keeps its engine between visits.
/** The Options screen shown over the running game (from the pause menu); `done` runs when it is closed. */
let overlayOptions: OptionsScreen | null = null;
function showOptionsOverGame(done: () => void): void {
  overlayOptions?.exit();
  const screen = new OptionsScreen(container, settings, () => { screen.exit(); overlayOptions = null; done(); }, true);
  overlayOptions = screen;
  screen.enter();
}
const gameView = new GameView(canvas, () => { overlayOptions?.exit(); overlayOptions = null; show("menu"); }, settings, showOptionsOverGame);
const screens: Record<ScreenId, () => Screen> = {
  splash: () => new SplashScreen(container, () => show("menu")),
  menu: () => new MainMenuScreen(container, () => show("load"), () => show("profile"), () => show("options"), () => show("gallery"), () => show("viewer")),
  viewer: () => new CharacterViewerScreen(container, canvas, () => show("menu")),
  options: () => new OptionsScreen(container, settings, () => show("menu")),
  gallery: () => new LoadingGalleryScreen(container, () => show("menu")),
  profile: () => new ProfileScreen(container, loadWorld, () => show("menu")),
  load: () => new LoadGameScreen(loadWorld, () => show("menu"), container),
  game: () => gameView,
  loading: () => { throw new Error("the loading screen is started by loadWorld"); },
};

// Dev shortcut: /?autoload (or /?autoload=<part of a save's file name>) skips the splash and menus and opens the world from the dev server's local files.
async function devAutoload(): Promise<void> {
  const { localDevSources } = await import("./assets/sources.ts");
  const { PakIndex } = await import("./assets/Pak.ts");
  const { parseSave } = await import("./formats/Jad.ts");
  const { loadWorldData } = await import("./world/WorldData.ts");
  const { readStrings } = await import("./assets/sources.ts");
  // The same loading screen as Load Game, so the scene's first frames are covered too.
  loadWorld(async (progress) => {
    progress.report(0.05, "Finding local files");
    const local = await localDevSources(new URLSearchParams(location.search).get("autoload") || undefined); // /?autoload=quick picks a save by name
    if (!local?.save) throw new Error("autoload: the dev server has no local game files");
    progress.report(0.3, "Reading archives");
    const pak = await PakIndex.open(local.paks);
    progress.report(0.4, "Reading the saved game");
    const save = parseSave(await local.save.read(0, local.save.size));
    progress.report(0.45, "Reading the text database");
    const strings = await readStrings(local.text);
    progress.report(0.5, "Building the world");
    const world = await loadWorldData(pak, save, (t) => progress.report(null, t), strings);
    for (const w of world.warnings) console.warn(w);
    return world;
  });
}

if (import.meta.env.DEV && new URLSearchParams(location.search).has("autoload")) {
  devAutoload().catch((e) => { console.error(e); show("load"); });
} else {
  show("splash");
}
