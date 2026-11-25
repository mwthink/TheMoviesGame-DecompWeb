import "./style.css";
import type { Screen } from "./screens/Screen.ts";
import { SplashScreen } from "./screens/SplashScreen.ts";
import { MainMenuScreen } from "./screens/MainMenuScreen.ts";
import { GameView } from "./screens/GameView.ts";
import { LoadGameScreen } from "./screens/LoadGameScreen.ts";

type ScreenId = "splash" | "menu" | "load" | "game";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const container = document.getElementById("screens") as HTMLElement;

let current: Screen | null = null;

function show(id: ScreenId): void {
  current?.exit();
  current = screens[id]();
  document.body.dataset.screen = id;
  current.enter();
}

// Screens are built on demand so each visit starts fresh. GameView keeps its engine between visits.
const gameView = new GameView(canvas, () => show("menu"));
const screens: Record<ScreenId, () => Screen> = {
  splash: () => new SplashScreen(container, () => show("menu")),
  menu: () => new MainMenuScreen(container, () => show("load")),
  load: () => new LoadGameScreen((world) => { gameView.world = world; show("game"); }, () => show("menu"), container),
  game: () => gameView,
};

// Dev shortcut: /?autoload (or /?autoload=<part of a save's file name>) skips the splash and menus and opens the world from the dev server's local files.
async function devAutoload(): Promise<void> {
  const { localDevSources } = await import("./assets/sources.ts");
  const { PakIndex } = await import("./assets/Pak.ts");
  const { parseSave } = await import("./formats/Jad.ts");
  const { loadWorldData } = await import("./world/WorldData.ts");
  const local = await localDevSources(new URLSearchParams(location.search).get("autoload") || undefined); // /?autoload=quick picks a save by name
  if (!local?.save) throw new Error("autoload: the dev server has no local game files");
  const { readStrings } = await import("./assets/sources.ts");
  const world = await loadWorldData(await PakIndex.open(local.paks), parseSave(await local.save.read(0, local.save.size)), undefined, await readStrings(local.text));
  for (const w of world.warnings) console.warn(w);
  gameView.world = world;
  show("game");
}

if (import.meta.env.DEV && new URLSearchParams(location.search).has("autoload")) {
  devAutoload().catch((e) => { console.error(e); show("splash"); });
} else {
  show("splash");
}
