import type { PakIndex } from "../assets/Pak.ts";
import { LoadingBackdrop } from "./LoadingBackdrop.ts";
import { LoadingCharacter } from "./LoadingCharacter.ts";
import type { LoadingScene } from "./loadingScenes.ts";

/** The drawn layers of a loading scene (docs/LOADING_SCREENS.md, "New loading scenes"). */
export interface SceneLayers {
  /** Move the layers to another host (behind `before`) and start the character running: they were built ahead of time on a hidden stage (`loadingPreload.ts`). */
  moveTo(host: HTMLElement, before: Element): void;
  dispose(): void;
}

/**
 * Draw a scene's layers into `host` (a loading screen element): its colour, the set behind, the character in front of it, all behind `before` (the view with the text box). Used by the
 * real loading screen, by the scene editor's preview and by the preloader. Returns null, leaving `host` as it was, when the character cannot be built (no costume or clip); a set that
 * cannot be drawn only leaves the colour. With `running` false the character's render loop is left stopped (for a hidden host) until `moveTo`.
 */
export async function buildSceneLayers(pak: PakIndex, host: HTMLElement, before: Element | null, scene: LoadingScene, running = true): Promise<SceneLayers | null> {
  host.classList.add("scene"); // first: the canvases take their size from the CSS this class gives them
  const character = new LoadingCharacter(pak, host, before);
  character.setRunning(running);
  try {
    await character.set(scene.character);
    if (!character.ready) throw new Error("the character did not load");
  } catch (e) {
    console.warn("new loading scene unavailable:", e);
    character.dispose();
    host.classList.remove("scene");
    return null;
  }
  let backdrop: LoadingBackdrop | null = null;
  if (scene.backdrop) {
    // the set goes behind the character; if it cannot be drawn the flat colour stays
    const b = new LoadingBackdrop(pak, host, character.canvas);
    try {
      await b.set(scene.backdrop);
      backdrop = b;
    } catch (e) {
      console.warn("loading backdrop unavailable, using the colour:", e);
      b.dispose();
    }
  }
  let current = host;
  const dress = (h: HTMLElement) => { h.classList.add("scene"); h.style.background = scene.background; };
  const undress = (h: HTMLElement) => { h.classList.remove("scene"); h.style.background = ""; };
  dress(host);
  return {
    moveTo(newHost, newBefore) {
      undress(current);
      current = newHost;
      dress(newHost);
      character.moveTo(newHost, newBefore);
      backdrop?.moveTo(newHost, character.canvas);
      character.setRunning(true);
    },
    dispose() {
      character.dispose();
      backdrop?.dispose();
      undress(current);
    },
  };
}
