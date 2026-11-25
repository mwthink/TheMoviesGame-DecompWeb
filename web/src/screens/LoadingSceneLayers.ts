import type { PakIndex } from "../assets/Pak.ts";
import { LoadingBackdrop } from "./LoadingBackdrop.ts";
import { LoadingCharacter } from "./LoadingCharacter.ts";
import type { LoadingScene } from "./loadingScenes.ts";

/** The drawn layers of a loading scene (docs/LOADING_SCREENS.md, "New loading scenes"). */
export interface SceneLayers {
  dispose(): void;
}

/**
 * Draw a scene's layers into `host` (a loading screen element): its colour, the set behind, the character in front of it, all behind `before` (the view with the text box). Used by the
 * real loading screen and by the scene editor's preview. Returns null, leaving `host` as it was, when the character cannot be built (no costume or clip); a set that cannot be drawn
 * only leaves the colour.
 */
export async function buildSceneLayers(pak: PakIndex, host: HTMLElement, before: Element, scene: LoadingScene): Promise<SceneLayers | null> {
  host.classList.add("scene"); // first: the canvases take their size from the CSS this class gives them
  const character = new LoadingCharacter(pak, host, before);
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
  host.style.background = scene.background;
  return {
    dispose() {
      character.dispose();
      backdrop?.dispose();
      host.classList.remove("scene");
      host.style.background = "";
    },
  };
}
