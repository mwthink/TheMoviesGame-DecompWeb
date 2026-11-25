import type { ByteSource } from "../assets/ByteSource.ts";
import { PakIndex } from "../assets/Pak.ts";
import { readStrings } from "../assets/sources.ts";
import { parseSave } from "../formats/Jad.ts";
import { formatDate } from "../sim/core/GameClock.ts";
import { formatMoney } from "../ui/GameToolbar.ts";
import { chooseFolder, chooseSaveFile, currentInstall, listSaves, onLinkChange, pendingLinks, readDrop, regrantLinks, restoreLinks, savesLabel, type SaveEntry } from "./gameLink.ts";
import type { LoadTask } from "./LoadingScreen.ts";
import { loadWorldData, type WorldData } from "../world/WorldData.ts";
import { mountScreen, unmountScreen, type Screen } from "./Screen.ts";

/** The work of loading a saved game with the linked install, for the loading screen (Load Game, Continue, the dev autoload). */
export function loadSaveTask(open: () => Promise<ByteSource>): LoadTask<WorldData> {
  return async (progress) => {
    progress.report(0.05, "Reading archives");
    await restoreLinks();
    const install = currentInstall();
    if (!install) throw new Error("The game folder is not linked. Choose it on the Find your game screen.");
    const pak = await PakIndex.open(install.paks);
    progress.report(0.3, "Reading the saved game");
    const src = await open();
    const save = parseSave(await src.read(0, src.size));
    progress.report(0.4, "Reading the text database");
    const strings = await readStrings(install.text);
    progress.report(0.45, "Building the world");
    const world = await loadWorldData(pak, save, (t) => progress.report(null, t), strings);
    for (const w of world.warnings) console.warn(w);
    return world;
  };
}

/** One line about a save: studio, in-game date, cash. */
export function describeEntry(s: SaveEntry): string {
  if (!s.summary) return s.name;
  const studio = s.summary.studio || "(unnamed studio)";
  return `${studio} · ${formatDate(s.summary.date)} · ${formatMoney(s.summary.cash)}`;
}

/**
 * Load Game: the saved games of the linked folder, newest first, each with what its header says (studio, in-game date, cash, when it was saved). A `.jad` can also be
 * opened from anywhere or dropped on the window. The game folder is linked elsewhere (`LinkGameScreen`) and only shown here.
 *
 * The screen object outlives a failed load: the loading screen's Back returns to the same object, with the same save chosen and the error under the list.
 */
export class LoadGameScreen implements Screen {
  private el: HTMLElement | null = null;
  private off: (() => void) | null = null;
  private entries: SaveEntry[] | null = null;
  /** A save opened from a file or a drop, shown at the top of the list. */
  private extra: SaveEntry | null = null;
  private selected: SaveEntry | null = null;
  private message = "";
  private isError = false;
  private listing = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly onStart: (task: LoadTask<WorldData>) => void,
    private readonly onBack: () => void,
    private readonly onLinkGame: () => void,
  ) {}

  enter(): void {
    const el = (this.el = mountScreen(this.container, "menu load"));
    el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("dropping"); });
    el.addEventListener("dragleave", () => el.classList.remove("dropping"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("dropping");
      if (!e.dataTransfer) return;
      void readDrop(e.dataTransfer).then((r) => {
        if (r.kind === "save") this.pickExtra(r.entry);
        else if (r.error) this.say(r.error, true);
        else this.say(r.kind === "install" ? "Game folder linked." : "Saved games folder linked.");
      });
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.onBack();
    });
    this.off = onLinkChange(() => void this.refresh());
    this.render();
    void this.refresh();
  }

  exit(): void {
    this.off?.();
    if (this.el) { void unmountScreen(this.el); this.el = null; }
  }

  /** Show a load error (after the loading screen's Back) under the list, keeping the chosen save. */
  showError(message: string): void {
    if (message) this.say(message, true);
  }

  private say(text: string, isError = false): void {
    this.message = text;
    this.isError = isError;
    const s = this.el?.querySelector<HTMLElement>('[data-id="status"]');
    if (s) { s.textContent = text; s.classList.toggle("error", isError); }
  }

  private async refresh(): Promise<void> {
    const token = ++this.listing;
    const list = await listSaves();
    if (token !== this.listing) return;
    this.entries = list;
    if (this.selected && !this.selected.summary) this.selected = null;
    // keep the choice across a refresh (by name); else the newest
    const keep = this.selected && (this.selected === this.extra || list.find((s) => s.name === this.selected!.name));
    this.selected = keep ? (this.selected === this.extra ? this.extra : list.find((s) => s.name === this.selected!.name)!) : list.find((s) => s.summary) ?? this.extra;
    this.render();
  }

  private pickExtra(entry: SaveEntry): void {
    if (!entry.summary) { this.say(`${entry.name}: ${entry.error ?? "not a saved game"}`, true); return; }
    this.extra = entry;
    this.selected = entry;
    this.say("");
    this.render();
  }

  private render(): void {
    const el = this.el;
    if (!el) return;
    const install = currentInstall();
    const pend = pendingLinks();
    const folder = savesLabel();
    const all = [...(this.extra ? [this.extra] : []), ...(this.entries ?? [])];
    const item = (s: SaveEntry, i: number) => {
      const saved = s.summary?.savedAt ? `saved ${s.summary.savedAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "";
      const from = s === this.extra ? "opened file" : "";
      return `<li><button type="button" class="save ${s === this.selected ? "selected" : ""}" data-i="${i}" ${s.summary ? "" : "disabled"}
        aria-pressed="${s === this.selected}" title="${esc(s.name)}">
        <b>${esc(s.summary ? s.summary.studio || "(unnamed studio)" : s.name)}</b>
        <span>${s.summary ? `${esc(formatDate(s.summary.date))} · ${esc(formatMoney(s.summary.cash))}` : esc(s.error ?? "not a saved game")}</span>
        <small>${esc([saved, from].filter(Boolean).join(" · "))}</small></button></li>`;
    };
    const listHtml = all.length
      ? `<ul class="saves">${all.map(item).join("")}</ul>`
      : `<p class="note empty">${this.entries === null ? "Reading saved games…"
        : folder ? `No saved games in ${esc(folder)}.`
        : pend.saves ? `${esc(pend.saves)} needs your permission again.`
        : "Choose the game's saved games folder once (Documents/The Movies/Saved Games) and its saves are listed here from then on. You can also open or drop a single .jad."}</p>`;
    el.innerHTML = `
      <h2>Load Game</h2>
      <div class="loadbox">
        <div class="row ${install ? "ok" : ""}"><span>Game</span>
          <em>${install ? `✓ ${esc(install.label)}` : pend.install ? `${esc(pend.install)} needs your permission again` : "not linked"}</em>
          ${!install && pend.install ? `<button type="button" data-id="regrant">Allow</button>` : ""}
          <button type="button" data-id="link">${install ? "Change…" : "Link…"}</button></div>
        <div class="row"><span>Saved games</span><em>${folder ? esc(folder) : pend.saves ? `${esc(pend.saves)} (needs permission)` : "no folder chosen"}</em>
          ${!folder && pend.saves ? `<button type="button" data-id="regrant-saves">Allow</button>` : ""}
          <button type="button" data-id="folder">${folder ? "Change…" : "Choose folder…"}</button>
          <button type="button" data-id="file">Open .jad…</button></div>
        ${listHtml}
        <p class="status ${this.isError ? "error" : ""}" data-id="status">${esc(this.message)}</p>
        <div class="row actions"><button type="button" data-id="back">Back</button>
          <button type="button" data-id="load" ${install && this.selected?.summary ? "" : "disabled"}>Load</button></div>
      </div>`;
    const $ = (id: string) => el.querySelector<HTMLButtonElement>(`[data-id="${id}"]`);
    $("back")!.addEventListener("click", this.onBack);
    $("link")!.addEventListener("click", this.onLinkGame);
    const regrant = () => void regrantLinks().then((ok) => { if (!ok) this.say("Permission was not granted. Choose the folder again.", true); });
    $("regrant")?.addEventListener("click", regrant);
    $("regrant-saves")?.addEventListener("click", regrant);
    $("folder")!.addEventListener("click", () => void chooseFolder("saves").then((r) => {
      if (r !== "cancelled" && r) this.say(r, true);
    }));
    $("file")!.addEventListener("click", () => void chooseSaveFile().then((e) => { if (e) this.pickExtra(e); }));
    $("load")!.addEventListener("click", () => this.load());
    for (const b of el.querySelectorAll<HTMLButtonElement>("button.save")) {
      const entry = all[Number(b.dataset.i)]!;
      b.addEventListener("click", () => {
        this.selected = entry;
        for (const o of el.querySelectorAll<HTMLButtonElement>("button.save")) {
          o.classList.toggle("selected", o === b);
          o.setAttribute("aria-pressed", String(o === b));
        }
        const load = $("load")!;
        load.disabled = !install;
      });
      b.addEventListener("dblclick", () => { this.selected = entry; this.load(); });
      b.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); this.selected = entry; this.load(); } });
    }
    (el.querySelector<HTMLButtonElement>("button.save.selected") ?? (install ? $("folder") : $("link")))?.focus();
  }

  /** Hands the work to the loading screen, which shows the progress and then the world. */
  private load(): void {
    const entry = this.selected;
    if (!entry?.summary || !currentInstall()) return;
    this.say("");
    this.onStart(loadSaveTask(entry.open));
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
