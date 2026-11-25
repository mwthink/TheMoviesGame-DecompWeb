import { canPickDirectory, chooseFolder, currentInstall, onLinkChange, pendingLinks, readDrop, regrantLinks, savesLabel } from "./gameLink.ts";
import { mountScreen, unmountScreen, type Screen } from "./Screen.ts";

/**
 * "Find your copy of The Movies": links the game install (needed for everything past the splash) and, optionally, the saved games folder. Shown on a first visit
 * in place of the main menu, and whenever a screen that needs the game files is opened without them. Both folders are remembered (`gameLink.ts`).
 */
export class LinkGameScreen implements Screen {
  private el: HTMLElement | null = null;
  private off: (() => void) | null = null;
  private message = "";
  private isError = false;

  /** `onDone` continues to where the player was going; `onBack` leaves without linking. */
  constructor(private readonly container: HTMLElement, private readonly onDone: () => void, private readonly onBack: () => void) {}

  enter(): void {
    this.el = mountScreen(this.container, "menu load link");
    this.el.addEventListener("dragover", (e) => { e.preventDefault(); this.el?.classList.add("dropping"); });
    this.el.addEventListener("dragleave", () => this.el?.classList.remove("dropping"));
    this.el.addEventListener("drop", (e) => {
      e.preventDefault();
      this.el?.classList.remove("dropping");
      if (!e.dataTransfer) return;
      void readDrop(e.dataTransfer).then((r) => {
        if (r.kind === "save") this.say("That is a saved game. Link the game folder first; saves are opened from Load Game.", true);
        else this.say(r.error ?? (r.kind === "install" ? "Game folder linked." : "Saved games folder linked."), r.error !== null);
      });
    });
    this.off = onLinkChange(() => this.render());
    this.render();
  }

  exit(): void {
    this.off?.();
    if (this.el) { void unmountScreen(this.el); this.el = null; }
  }

  private say(text: string, isError = false): void {
    this.message = text;
    this.isError = isError;
    this.render();
  }

  private render(): void {
    const el = this.el;
    if (!el) return;
    const install = currentInstall();
    const pend = pendingLinks();
    const saves = savesLabel();
    el.innerHTML = `
      <h2>Find your game</h2>
      <div class="loadbox">
        <p class="note">This app plays from your own copy of <i>The Movies</i> (with <i>Stunts &amp; Effects</i>, patch 1.2). Point it at the game once and it is
          remembered. Nothing is uploaded or copied: files are read from this computer as they are needed.</p>
        <div class="row ${install ? "ok" : ""}"><span>Game folder</span>
          <em>${install ? `✓ ${esc(install.label)} · ${install.paks.length} archives` : pend.install ? `${esc(pend.install)} (needs your permission again)` : "the folder holding MoviesSE.exe and Data"}</em>
          ${pend.install && !install ? `<button type="button" data-id="regrant">Allow ${esc(pend.install)}</button>` : ""}
          <button type="button" data-id="install">${install ? "Change…" : "Choose folder…"}</button></div>
        <div class="row ${saves ? "ok" : ""}"><span>Saved games</span>
          <em>${saves ? `✓ ${esc(saves)}` : pend.saves ? `${esc(pend.saves)} (needs your permission again)` : "optional: Documents/The Movies/Saved Games"}</em>
          <button type="button" data-id="saves">${saves ? "Change…" : "Choose folder…"}</button></div>
        <details class="hints">
          <summary>Where is it?</summary>
          <ul>
            <li><b>Windows:</b> where the game was installed, usually under Program Files. The right folder has <code>MoviesSE.exe</code> and a <code>Data</code> folder in it.</li>
            <li><b>Mac with CrossOver:</b> inside the bottle, under <code>~/Library/Application Support/CrossOver/Bottles/&lt;bottle&gt;/drive_c</code>. The folder
              picker hides Library: press <kbd>⌘</kbd><kbd>⇧</kbd><kbd>G</kbd> and type the path, or <kbd>⌘</kbd><kbd>⇧</kbd><kbd>.</kbd> to show hidden folders.</li>
            <li><b>Saved games:</b> the game writes them to <code>Documents/The Movies/Saved Games</code> (under CrossOver, usually your own Documents folder).
              Choosing <code>The Movies</code> works too.</li>
            <li>You can also drag either folder onto this window.</li>
          </ul>
        </details>
        ${canPickDirectory ? "" : `<p class="note">This browser cannot remember folders, so you will be asked again on each visit. Chrome and Edge remember them.</p>`}
        <p class="status ${this.isError ? "error" : ""}" data-id="status">${esc(this.message)}</p>
        <div class="row actions"><button type="button" data-id="back">${install ? "Back" : "Not now"}</button>
          <button type="button" data-id="done" ${install ? "" : "disabled"}>Continue</button></div>
      </div>`;
    const $ = (id: string) => el.querySelector<HTMLButtonElement>(`[data-id="${id}"]`);
    $("back")!.addEventListener("click", this.onBack);
    $("done")!.addEventListener("click", this.onDone);
    $("regrant")?.addEventListener("click", () => void regrantLinks().then((ok) => { if (!ok) this.say("Permission was not granted. Choose the folder again.", true); }));
    for (const kind of ["install", "saves"] as const) {
      $(kind)!.addEventListener("click", () => void chooseFolder(kind).then((r) => {
        if (r === "cancelled") return;
        this.say(r ?? (kind === "install" ? "Game folder linked." : "Saved games folder linked."), r !== null);
      }));
    }
    (install ? $("done") : $("install"))?.focus();
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
