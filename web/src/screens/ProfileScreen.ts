import { gamePak, gameStrings } from "./frontEndArt.ts";
import type { LoadTask } from "./LoadingScreen.ts";
import { mountScreen, unmountScreen, type Screen } from "./Screen.ts";
import { loadNewGameWorld } from "../world/NewGameWorld.ts";
import type { WorldData } from "../world/WorldData.ts";

/**
 * The profile screen a New Game opens (WProfileScreen, docs/FRONTEND.md "From the button to the game"): the studio's name and the owner's name. Confirming
 * starts the game; the original refuses a start with no name (`PROFILESCREEN_CANCELNONAME`), so Start stays off until both are filled in.
 * The studio icon (`ui/fullsrn_studioicon.dds`) is not drawn yet.
 */
export class ProfileScreen implements Screen {
  private el: HTMLElement | null = null;

  constructor(private readonly container: HTMLElement, private readonly onStart: (task: LoadTask<WorldData>) => void, private readonly onBack: () => void) {}

  enter(): void {
    const el = (this.el = mountScreen(this.container, "menu load"));
    el.innerHTML = `
      <h2>New Game</h2>
      <div class="loadbox">
        <div class="row"><span>Studio name</span><input type="text" data-id="studio" maxlength="40" autocomplete="off"></div>
        <div class="row"><span>Your name</span><input type="text" data-id="owner" maxlength="40" autocomplete="off"></div>
        <div class="row actions"><button type="button" data-id="back">Back</button><button type="button" data-id="start" disabled>Start</button></div>
        <p class="status" data-id="status"></p>
      </div>`;
    const $ = <T extends HTMLElement>(id: string) => el.querySelector<T>(`[data-id="${id}"]`)!;
    const studio = $<HTMLInputElement>("studio"), owner = $<HTMLInputElement>("owner"), start = $<HTMLButtonElement>("start");
    const refresh = () => { start.disabled = !studio.value.trim() || !owner.value.trim(); };
    studio.addEventListener("input", refresh);
    owner.addEventListener("input", refresh);
    for (const input of [studio, owner]) input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !start.disabled) start.click(); });
    $("back").addEventListener("click", this.onBack);
    start.addEventListener("click", () => {
      const profile = { studioName: studio.value.trim(), ownerName: owner.value.trim() };
      this.onStart(async (progress) => {
        progress.report(0.05, "Reading archives");
        const pak = await gamePak();
        if (!pak) throw new Error("The game's data archives were not found. Choose the game folder under Load Game first.");
        progress.report(0.4, "Reading the text database");
        const strings = await gameStrings();
        progress.report(0.45, "Building the world");
        const world = await loadNewGameWorld(pak, profile, (t) => progress.report(null, t), strings);
        for (const w of world.warnings) console.warn(w);
        return world;
      });
    });
    studio.focus();
  }

  exit(): void {
    if (this.el) { void unmountScreen(this.el); this.el = null; }
  }
}
