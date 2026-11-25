import "./style.css";
import type { Screen } from "./screens/Screen.ts";
import { SplashScreen } from "./screens/SplashScreen.ts";
import { MainMenuScreen } from "./screens/MainMenuScreen.ts";
import { GameView } from "./screens/GameView.ts";
import { LoadGameScreen } from "./screens/LoadGameScreen.ts";
import { LoadingScreen, type LoadTask } from "./screens/LoadingScreen.ts";
import type { WorldData } from "./world/WorldData.ts";

type ScreenId = "splash" | "menu" | "load" | "loading" | "game";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const container = document.getElementById("screens") as HTMLElement;

let current: Screen | null = null;

function present(id: ScreenId, screen: Screen): void {
  current?.exit();
  current = screen;
  document.body.dataset.screen = id;
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
    void gameView.ready.then(() => loading.exit());
  }, () => show("load"));
  present("loading", loading);
}

// Screens are built on demand so each visit starts fresh. GameView keeps its engine between visits.
const gameView = new GameView(canvas, () => show("menu"));
const screens: Record<ScreenId, () => Screen> = {
  splash: () => new SplashScreen(container, () => show("menu")),
  menu: () => new MainMenuScreen(container, () => show("load")),
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
