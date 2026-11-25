import type { ByteSource } from "../assets/ByteSource.ts";
import { PakIndex } from "../assets/Pak.ts";
import { recallGameFolder, rememberGameFolder } from "../assets/remembered.ts";
import {
  canPickDirectory, ensureReadable, localDevSources, pakSourcesFromDirectory, pakSourcesFromFiles, readStrings, stringSourcesFromDirectory, stringSourcesFromFiles,
} from "../assets/sources.ts";
import { parseSave } from "../formats/Jad.ts";
import { setGameArchives, setGameText } from "./frontEndArt.ts";
import type { LoadTask } from "./LoadingScreen.ts";
import { loadWorldData, type WorldData } from "../world/WorldData.ts";
import { mountScreen, unmountScreen, type Screen } from "./Screen.ts";

/**
 * Load Game: the player points at their own game install (for the archives) and a saved game; the world is built from those.
 * Nothing is uploaded anywhere and nothing is copied: the archives are read in slices from disk.
 */
export class LoadGameScreen implements Screen {
  private el: HTMLElement | null = null;
  private paks: ByteSource[] = [];
  private text: ByteSource[] = [];
  private saveBytes: (() => Promise<Uint8Array>) | null = null;
  private saveLabel = "";
  private remembered: FileSystemDirectoryHandle | null = null;
  private readonly onStart: (task: LoadTask<WorldData>) => void;
  private readonly onBack: () => void;

  constructor(onStart: (task: LoadTask<WorldData>) => void, onBack: () => void, private readonly container: HTMLElement) {
    this.onStart = onStart;
    this.onBack = onBack;
  }

  enter(): void {
    this.el = mountScreen(this.container, "menu load");
    this.render();
    void recallGameFolder().then((h) => {
      this.remembered = h;
      this.render();
    });
  }

  exit(): void {
    if (this.el) { void unmountScreen(this.el); this.el = null; }
  }

  private render(): void {
    const el = this.el;
    if (!el) return;
    const dev = import.meta.env.DEV;
    el.innerHTML = `
      <h2>Load Game</h2>
      <div class="loadbox">
        <p class="note">Choose your own copy of the game (for its data archives) and a saved game. Files stay on this computer.</p>
        <div class="row"><span>Game folder</span><em data-id="paks">${this.paks.length ? `${this.paks.length} archives found` : "not chosen"}</em>
          ${this.remembered && !this.paks.length ? `<button type="button" data-id="reuse">Use ${esc(this.remembered.name)}</button>` : ""}
          <button type="button" data-id="folder">Choose folder…</button></div>
        <div class="row"><span>Saved game</span><em data-id="save">${this.saveLabel || "not chosen"}</em>
          <button type="button" data-id="file">Choose .jad…</button></div>
        ${dev ? `<div class="row"><span>Development</span><em>files from the dev server</em><button type="button" data-id="dev">Use local files</button></div>` : ""}
        <div class="row actions"><button type="button" data-id="back">Back</button>
          <button type="button" data-id="load" ${this.paks.length && this.saveBytes ? "" : "disabled"}>Load</button></div>
        <p class="status" data-id="status"></p>
      </div>
      <input type="file" accept=".jad" hidden data-id="fileinput">
      <input type="file" webkitdirectory multiple hidden data-id="dirinput">`;
    const $ = <T extends HTMLElement>(id: string) => el.querySelector<T>(`[data-id="${id}"]`);

    $("back")!.addEventListener("click", this.onBack);
    $("reuse")?.addEventListener("click", () => void this.useFolder(this.remembered!));
    $("folder")!.addEventListener("click", () => {
      if (canPickDirectory) void this.pickFolder();
      else $<HTMLInputElement>("dirinput")!.click();
    });
    $<HTMLInputElement>("dirinput")!.addEventListener("change", (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files) { this.text = stringSourcesFromFiles(files); setGameText(this.text); this.setPaks(pakSourcesFromFiles(files)); }
    });
    $("file")!.addEventListener("click", () => $<HTMLInputElement>("fileinput")!.click());
    $<HTMLInputElement>("fileinput")!.addEventListener("change", (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) {
        this.saveLabel = esc(f.name);
        this.saveBytes = async () => new Uint8Array(await f.arrayBuffer());
        this.render();
      }
    });
    $("dev")?.addEventListener("click", () => void this.useDev());
    $("load")!.addEventListener("click", () => this.load());
  }

  private status(text: string, isError = false): void {
    const s = this.el?.querySelector<HTMLElement>('[data-id="status"]');
    if (s) { s.textContent = text; s.classList.toggle("error", isError); }
  }

  private setPaks(paks: ByteSource[]): void {
    this.paks = paks;
    setGameArchives(paks);
    this.render();
    if (!paks.length) this.status("No .pak files found there. Pick the game folder (the one with Data/pak inside).", true);
  }

  private async pickFolder(): Promise<void> {
    try {
      const dir = await window.showDirectoryPicker!({ mode: "read", id: "otm-game" });
      await this.useFolder(dir);
    } catch {
      /* cancelled */
    }
  }

  private async useFolder(dir: FileSystemDirectoryHandle): Promise<void> {
    if (!(await ensureReadable(dir))) { this.status("Read access to that folder was not granted.", true); return; }
    this.text = await stringSourcesFromDirectory(dir);
    setGameText(this.text);
    this.setPaks(await pakSourcesFromDirectory(dir));
    if (this.paks.length) void rememberGameFolder(dir);
  }

  private async useDev(): Promise<void> {
    const local = await localDevSources();
    if (!local) { this.status("The dev server has no local files configured.", true); return; }
    this.paks = local.paks;
    setGameArchives(local.paks);
    this.text = local.text;
    setGameText(local.text);
    if (local.save) {
      const save = local.save;
      this.saveLabel = esc(save.name);
      this.saveBytes = () => save.read(0, save.size);
    }
    this.render();
  }

  /** Hands the work to the loading screen, which shows the progress and then the world. */
  private load(): void {
    if (!this.saveBytes) return;
    const paks = this.paks;
    const text = this.text;
    const saveBytes = this.saveBytes;
    this.onStart(async (progress) => {
      progress.report(0.05, "Reading archives");
      const pak = await PakIndex.open(paks);
      progress.report(0.3, "Reading the saved game");
      const save = parseSave(await saveBytes());
      progress.report(0.4, "Reading the text database");
      const strings = await readStrings(text);
      progress.report(0.45, "Building the world");
      const world = await loadWorldData(pak, save, (t) => progress.report(null, t), strings);
      for (const w of world.warnings) console.warn(w);
      return world;
    });
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
