import "./style.css";
import type { Screen } from "./screens/Screen";
import { SplashScreen } from "./screens/SplashScreen";
import { MainMenuScreen } from "./screens/MainMenuScreen";
import { GameView } from "./screens/GameView";

type ScreenId = "splash" | "menu" | "game";

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
  menu: () => new MainMenuScreen(container, () => show("game")),
  game: () => gameView,
};

show("splash");
