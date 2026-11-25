import type { ByteSource } from "../assets/ByteSource.ts";
import { PakIndex } from "../assets/Pak.ts";
import { recallGameFolder } from "../assets/remembered.ts";
import { localDevSources, pakSourcesFromDirectory } from "../assets/sources.ts";
import { decodeDds, type Rgba } from "../formats/Dds.ts";

/**
 * The game's own front-end artwork, read from the player's install at run time (nothing is copied into the repository).
 * The Load Game screen hands over its archives; before that, the menus look for them in the dev server's files or the remembered folder.
 */

const LOGO = { name: "frontend_movieslogo.dds", dir: "data\\textures\\ui\\" };

let chosen: ByteSource[] = [];
let logo: Promise<Rgba | null> | null = null;

/** Called by the Load Game screen whenever the player picks a game folder (an empty list clears it). */
export function setGameArchives(paks: ByteSource[]): void {
  chosen = paks;
  logo = null;
}

async function findArchives(): Promise<ByteSource[]> {
  if (chosen.length) return chosen;
  const local = await localDevSources();
  if (local?.paks.length) return local.paks;
  // A remembered folder is used only if read access is still granted; asking for it needs a click, so none is asked here.
  const dir = await recallGameFolder();
  if (dir && (await (dir as FileSystemDirectoryHandle & { queryPermission?(o: { mode: "read" }): Promise<PermissionState> }).queryPermission?.({ mode: "read" })) === "granted") {
    return pakSourcesFromDirectory(dir);
  }
  return [];
}

/** The game's "The Movies" star logo as a new canvas (each screen gets its own), or null when no archives are available. */
export async function frontEndLogo(): Promise<HTMLCanvasElement | null> {
  const img = await (logo ??= loadLogo());
  if (!img) return null;
  // The texture has empty margins, and the artwork sits off-centre in it: crop to the visible pixels so the canvas centres on the logo.
  const box = opaqueBox(img);
  const canvas = document.createElement("canvas");
  canvas.width = box.width;
  canvas.height = box.height;
  canvas.className = "frontend-logo";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "The Movies");
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), -box.x, -box.y);
  return canvas;
}

/** One of the game's loading-screen pictures: its file name (without `.dds`) and a way to decode it. */
export interface LoadingPicture { name: string; load(): Promise<Rgba>; }

const LOADING_DIR = "data\\textures\\ui\\loadingscreens\\";

/**
 * The pictures the original shows while a game loads (every `.dds` in `ui\\loadingscreens`; orig: 0x00422580 `Game_PickLoadingScreen` picks
 * one uniformly at random per load, docs/LOADING_SCREENS.md), read from the player's install. Empty when no archives are available.
 */
export async function loadingPictures(): Promise<LoadingPicture[]> {
  try {
    const paks = await findArchives();
    if (!paks.length) return [];
    const pak = await PakIndex.open(paks);
    return pak.list(LOADING_DIR).map((f) => ({
      name: f.entry.name.replace(/\.dds$/i, ""),
      load: async () => decodeDds(await pak.read(f)),
    }));
  } catch (e) {
    console.warn("loading pictures unavailable:", e);
    return [];
  }
}

async function loadLogo(): Promise<Rgba | null> {
  try {
    const paks = await findArchives();
    if (!paks.length) return null;
    const pak = await PakIndex.open(paks);
    const bytes = await pak.readByName(LOGO.name, { dir: LOGO.dir });
    return bytes ? decodeDds(bytes) : null;
  } catch (e) {
    console.warn("front-end logo unavailable:", e);
    return null;
  }
}

/** The smallest rectangle holding every pixel with some alpha. */
function opaqueBox(img: Rgba): { x: number; y: number; width: number; height: number } {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3]! > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, width: img.width, height: img.height };
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
