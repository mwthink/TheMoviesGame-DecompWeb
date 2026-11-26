import { gamePak, gameStrings, randomLoadingPicture } from "./frontEndArt.ts";
import { buildSceneLayers, type SceneLayers } from "./LoadingSceneLayers.ts";
import { pickScene } from "./loadingScenes.ts";

/** What a loading screen shows behind its text box, made ahead of time. */
export type PreparedLoadingScreen =
  | { kind: "scene"; layers: SceneLayers }
  | { kind: "picture"; picture: { name: string; canvas: HTMLCanvasElement } };

export type LoadingMode = PreparedLoadingScreen["kind"];

/**
 * Loading screens that are ready before they are needed (docs/LOADING_SCREENS.md, "Preparing ahead"). Building a scene (the character's costume and textures, the set's model and ~40 textures,
 * shader compiles) or decoding a 1024 x 1024 picture takes long enough that the loading screen used to show a plain page first and pop the picture or scene in. `prepareLoadingScreen` does
 * that work while the player is in the menus: a picture is decoded, a scene is built on a hidden full-window stage with its character stopped. `takeLoadingScreen` hands the result over (waiting for it
 * if it is still being made, or making it if nothing was started) and the loading screen moves the layers into itself. One screen is kept ready at a time; after it is taken the next is
 * prepared when the player is next in the menus (`prepareLoadingScreen` is idempotent, so callers just call it often).
 */
let state: { mode: LoadingMode; ready: Promise<PreparedLoadingScreen | null> } | null = null;
let stage: HTMLElement | null = null;

/** The hidden host a scene is built in: full window (so its canvases get the size they will have), invisible, behind everything, out of the way of clicks. */
function stageElement(): HTMLElement {
  if (!stage) {
    stage = document.createElement("div");
    stage.className = "loading loadstage";
    stage.setAttribute("aria-hidden", "true");
    (document.getElementById("screens") ?? document.body).append(stage);
  }
  return stage;
}

async function make(mode: LoadingMode): Promise<PreparedLoadingScreen | null> {
  void gameStrings(); // the tips are read now too
  if (mode === "picture") {
    const picture = await randomLoadingPicture();
    return picture ? { kind: "picture", picture } : null;
  }
  const pak = await gamePak();
  if (!pak) return null;
  const scene = pickScene(Math.random, new URLSearchParams(window.location.search).get("loadingScene")); // ?loadingScene=right shows only the scenes named so
  const host = stageElement();
  // the stage holds only the layers, so they are appended; the loading screen puts them in front of its own view when it takes them
  const layers = await buildSceneLayers(pak, host, null, scene, false);
  return layers ? { kind: "scene", layers } : null;
}

function discard(s: NonNullable<typeof state>): void {
  void s.ready.then((p) => { if (p?.kind === "scene") p.layers.dispose(); }).catch(() => {});
}

/** Start making the next loading screen of this kind if none is ready or on its way (a screen of the other kind is thrown away). */
export function prepareLoadingScreen(mode: LoadingMode): void {
  if (state?.mode === mode) return;
  if (state) discard(state);
  state = { mode, ready: make(mode).catch((e) => { console.warn("loading screen could not be prepared:", e); return null; }) };
}

/** The prepared loading screen of this kind (made now if none was started); null when it cannot be made (no game files, a missing costume). The caller owns it and disposes it. */
export function takeLoadingScreen(mode: LoadingMode): Promise<PreparedLoadingScreen | null> {
  prepareLoadingScreen(mode);
  const taken = state!;
  state = null;
  return taken.ready;
}
