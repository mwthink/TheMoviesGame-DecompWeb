import type { ByteSource } from "../assets/ByteSource.ts";
import { BlobSource } from "../assets/ByteSource.ts";
import { recallFolder, rememberFolder, type RememberedFolder } from "../assets/remembered.ts";
import {
  canPickDirectory, localDevSources, pakSourcesFromDirectory, pakSourcesFromFiles, stringSourcesFromDirectory, stringSourcesFromFiles,
} from "../assets/sources.ts";
import { parseSaveSummary, SAVE_SUMMARY_BYTES, type SaveSummary } from "../formats/Jad.ts";

/**
 * The two folders of the player's own copy of the game that the app reads, linked once and remembered between visits:
 *
 * - the **install** (the folder with `Data/pak`): the archives and the string database, which every screen past the splash draws from;
 * - the **saved games** folder (`Documents/The Movies/Saved Games`, a different place from the install), which the Load Game list and Continue read.
 *
 * A folder chosen with the File System Access API (Chromium) is stored in IndexedDB. On a later visit its read permission is usually back to "prompt", and asking
 * for it needs a click: `restoreLinks` uses what is still granted without asking, and `regrantLinks` (run from a click, such as the splash's) asks for the rest.
 * Browsers without that API pick folders with `<input webkitdirectory>`, which cannot be remembered. In the dev server the local files stand in for both.
 */

export interface InstallLink {
  paks: ByteSource[];
  text: ByteSource[];
  /** The folder's name, for "Game: <name>". */
  label: string;
}

/** A saved game in the list: where it came from and what its header says (null with `error` when the file is not a save). */
export interface SaveEntry {
  name: string;
  /** Sort key: the header's save time, else the file's modification time (ms since 1970). */
  time: number;
  /** The file's modification time (ms since 1970; 0 when unknown): breaks ties between saves made in the same minute. */
  modified: number;
  summary: SaveSummary | null;
  error?: string;
  open(): Promise<ByteSource>;
}

interface SavesLink {
  label: string;
  list(): Promise<{ name: string; modified: number; open(): Promise<ByteSource> }[]>;
}

/** What still waits for a click: remembered folders whose permission is not granted in this visit. */
export interface PendingLinks { install: string | null; saves: string | null; }

let install: InstallLink | null = null;
let saves: SavesLink | null = null;
const pending: Record<RememberedFolder, FileSystemDirectoryHandle | null> = { gameFolder: null, savesFolder: null };
const listeners = new Set<() => void>();
let restored: Promise<void> | null = null;

/** Called whenever a link changes (linked, re-granted, cleared). Returns the unsubscribe. */
export function onLinkChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function changed(): void { for (const cb of [...listeners]) cb(); }

export function currentInstall(): InstallLink | null { return install; }
export function hasSavesFolder(): boolean { return saves !== null; }
export function savesLabel(): string | null { return saves?.label ?? null; }
export function pendingLinks(): PendingLinks {
  return { install: install ? null : pending.gameFolder?.name ?? null, saves: saves ? null : pending.savesFolder?.name ?? null };
}

type Permissioned = FileSystemDirectoryHandle & {
  queryPermission?(o: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "read" }): Promise<PermissionState>;
};

/** Use what can be had without asking: the dev server's files, and remembered folders whose permission is still granted. Runs once; later calls wait for it. */
export function restoreLinks(): Promise<void> {
  return (restored ??= (async () => {
    const dev = await localDevSources();
    if (dev) {
      if (dev.paks.length) install = { paks: dev.paks, text: dev.text, label: "the dev server's files" };
      if (dev.saves.length) saves = { label: "the dev server's saves", list: async () => dev.saves };
    }
    for (const key of ["gameFolder", "savesFolder"] as const) {
      if (key === "gameFolder" ? install : saves) continue;
      const handle = (await recallFolder(key)) as Permissioned | null;
      if (!handle) continue;
      let state: PermissionState | undefined;
      try { state = await handle.queryPermission?.({ mode: "read" }); } catch { state = undefined; }
      if (state === "granted") {
        const err = key === "gameFolder" ? await linkInstallFolder(handle, false) : await linkSavesFolder(handle, false);
        if (err) pending[key] = null;
      } else if (state === "prompt") {
        pending[key] = handle;
      }
    }
    changed();
  })());
}

/** Ask again for the remembered folders still waiting. Must run inside a click or key press (the browser refuses otherwise). True if anything was linked. */
export async function regrantLinks(): Promise<boolean> {
  let any = false;
  for (const key of ["gameFolder", "savesFolder"] as const) {
    const handle = pending[key] as Permissioned | null;
    if (!handle) continue;
    let state: PermissionState | undefined;
    try { state = await handle.requestPermission?.({ mode: "read" }); } catch { state = undefined; }
    if (state !== "granted") continue;
    pending[key] = null;
    const err = key === "gameFolder" ? await linkInstallFolder(handle, false) : await linkSavesFolder(handle, false);
    if (!err) any = true;
  }
  if (any) changed();
  return any;
}

/** Link the install from a chosen folder (the game folder, its `Data`, or `Data/pak`). Returns an error message, or null when linked. */
export async function linkInstallFolder(dir: FileSystemDirectoryHandle, remember = true): Promise<string | null> {
  const paks = await pakSourcesFromDirectory(dir);
  if (!paks.length) {
    return `No game archives (.pak) were found in “${dir.name}”. Choose the folder that holds MoviesSE.exe and Data.`
      + (/saved games|^the movies$/i.test(dir.name) ? " That looks like the saved games folder; the game itself is installed elsewhere." : "");
  }
  install = { paks, text: await stringSourcesFromDirectory(dir), label: dir.name };
  pending.gameFolder = null;
  if (remember) { void rememberFolder("gameFolder", dir); changed(); }
  // A saves folder chosen by mistake as the install would have no .pak; the reverse is caught in linkSavesFolder.
  return null;
}

/** Link the install from files picked with `<input webkitdirectory>` (browsers without folder handles; not remembered). */
export function linkInstallFiles(files: FileList): string | null {
  const paks = pakSourcesFromFiles(files);
  if (!paks.length) return "No game archives (.pak) were found there. Choose the folder that holds MoviesSE.exe and Data.";
  const first = files[0]?.webkitRelativePath.split("/")[0] ?? "the game folder";
  install = { paks, text: stringSourcesFromFiles(files), label: first };
  changed();
  return null;
}

/** Link the saved games folder: the `Saved Games` folder itself, or the `The Movies` folder above it. Returns an error message, or null when linked. */
export async function linkSavesFolder(dir: FileSystemDirectoryHandle, remember = true): Promise<string | null> {
  let target = dir;
  if (!(await hasJad(dir))) {
    for (const name of ["Saved Games", "saved games", "SavedGames"]) {
      try { const sub = await dir.getDirectoryHandle(name); if (await hasJad(sub)) { target = sub; break; } } catch { /* not there */ }
    }
  }
  if (!(await hasJad(target))) {
    return `No saved games (.jad) were found in “${dir.name}”. The game keeps them in Documents/The Movies/Saved Games.`;
  }
  saves = {
    label: target.name,
    list: async () => {
      const out: { name: string; modified: number; open(): Promise<ByteSource> }[] = [];
      for await (const e of target.values()) {
        if (e.kind !== "file" || !e.name.toLowerCase().endsWith(".jad")) continue;
        const file = await (e as FileSystemFileHandle).getFile();
        out.push({ name: e.name, modified: file.lastModified, open: async () => new BlobSource(e.name, await (e as FileSystemFileHandle).getFile()) });
      }
      return out;
    },
  };
  pending.savesFolder = null;
  if (remember) { void rememberFolder("savesFolder", target); changed(); }
  return null;
}

/** Link the saved games from files picked with `<input webkitdirectory>` (not remembered). */
export function linkSavesFiles(files: FileList): string | null {
  const jads = [...files].filter((f) => f.name.toLowerCase().endsWith(".jad"));
  if (!jads.length) return "No saved games (.jad) were found there. The game keeps them in Documents/The Movies/Saved Games.";
  const label = jads[0]!.webkitRelativePath.split("/").slice(-2)[0] || "Saved Games";
  saves = { label, list: async () => jads.map((f) => ({ name: f.name, modified: f.lastModified, open: async () => new BlobSource(f.name, f) })) };
  changed();
  return null;
}

async function hasJad(dir: FileSystemDirectoryHandle): Promise<boolean> {
  for await (const e of dir.values()) if (e.kind === "file" && e.name.toLowerCase().endsWith(".jad")) return true;
  return false;
}

/** Read a save's header for the list. A file that is not a save is kept with its error, so the list can say so. */
export async function describeSave(name: string, modified: number, open: () => Promise<ByteSource>): Promise<SaveEntry> {
  try {
    const src = await open();
    const summary = parseSaveSummary(await src.read(0, Math.min(src.size, SAVE_SUMMARY_BYTES)));
    return { name, time: summary.savedAt?.getTime() ?? modified, modified, summary, open };
  } catch (e) {
    return { name, time: modified, modified, summary: null, error: e instanceof Error ? e.message : String(e), open };
  }
}

/** The linked saved games, newest first (by the time the game saved them). Empty with no saves folder. */
export async function listSaves(): Promise<SaveEntry[]> {
  await restoreLinks();
  if (!saves) return [];
  const files = await saves.list();
  const entries = await Promise.all(files.map((f) => describeSave(f.name, f.modified, f.open)));
  return entries.sort((a, b) => b.time - a.time || b.modified - a.modified || a.name.localeCompare(b.name));
}

/** The newest loadable save, for Continue; null when there is none. */
export async function newestSave(): Promise<SaveEntry | null> {
  return (await listSaves()).find((s) => s.summary) ?? null;
}

/** Show the folder picker for the install (Chromium). Null when cancelled. */
export async function pickInstallFolder(): Promise<FileSystemDirectoryHandle | null> {
  try { return await window.showDirectoryPicker!({ mode: "read", id: "otm-game" }); } catch { return null; }
}

/** Show the folder picker for the saved games, starting in Documents (Chromium). Null when cancelled. */
export async function pickSavesFolder(): Promise<FileSystemDirectoryHandle | null> {
  try { return await window.showDirectoryPicker!({ mode: "read", id: "otm-saves", startIn: "documents" }); } catch { return null; }
}

export { canPickDirectory };

/** What a drop onto a screen turned out to be. */
export type DropResult =
  | { kind: "save"; entry: SaveEntry }
  | { kind: "install" | "saves"; error: string | null }
  | { kind: "none"; error: string };

/**
 * A file or folder dropped on the window: a `.jad` becomes the chosen save; a folder is linked as the install if it holds archives, else as the saves folder
 * if it holds saves. Folders need `getAsFileSystemHandle` (Chromium). Must be called during the drop event (the items go away after it).
 */
export function readDrop(dt: DataTransfer): Promise<DropResult> {
  const items = [...dt.items].filter((i) => i.kind === "file");
  type WithHandle = DataTransferItem & { getAsFileSystemHandle?(): Promise<FileSystemHandle | null> };
  const handles = items.map((i) => (i as WithHandle).getAsFileSystemHandle?.() ?? Promise.resolve(null));
  const files = [...dt.files];
  return (async (): Promise<DropResult> => {
    for (const h of await Promise.all(handles)) {
      if (h?.kind !== "directory") continue;
      const dir = h as FileSystemDirectoryHandle;
      if ((await pakSourcesFromDirectory(dir)).length) return { kind: "install", error: await linkInstallFolder(dir) };
      return { kind: "saves", error: await linkSavesFolder(dir) };
    }
    const jad = files.find((f) => f.name.toLowerCase().endsWith(".jad"));
    if (jad) return { kind: "save", entry: await describeSave(jad.name, jad.lastModified, async () => new BlobSource(jad.name, jad)) };
    return { kind: "none", error: canPickDirectory ? "Drop a .jad saved game, the game folder or the saved games folder." : "Drop a .jad saved game." };
  })();
}

/**
 * Let the player choose a folder and link it. Must run from a click. Uses the folder picker where there is one, else a hidden `<input webkitdirectory>`.
 * Resolves to an error message, null when linked, or "cancelled".
 */
export async function chooseFolder(kind: "install" | "saves"): Promise<string | null | "cancelled"> {
  if (canPickDirectory) {
    const dir = kind === "install" ? await pickInstallFolder() : await pickSavesFolder();
    if (!dir) return "cancelled";
    return kind === "install" ? linkInstallFolder(dir) : linkSavesFolder(dir);
  }
  const files = await pickWithInput((input) => { input.webkitdirectory = true; input.multiple = true; });
  if (!files) return "cancelled";
  return kind === "install" ? linkInstallFiles(files) : linkSavesFiles(files);
}

/** Choose one `.jad` file with the file dialog; null when cancelled. */
export async function chooseSaveFile(): Promise<SaveEntry | null> {
  const files = await pickWithInput((input) => { input.accept = ".jad"; });
  const f = files?.[0];
  return f ? describeSave(f.name, f.lastModified, async () => new BlobSource(f.name, f)) : null;
}

function pickWithInput(setup: (input: HTMLInputElement) => void): Promise<FileList | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.hidden = true;
    setup(input);
    const done = (v: FileList | null) => { input.remove(); resolve(v); };
    input.addEventListener("change", () => done(input.files?.length ? input.files : null), { once: true });
    input.addEventListener("cancel", () => done(null), { once: true });
    document.body.append(input);
    input.click();
  });
}
