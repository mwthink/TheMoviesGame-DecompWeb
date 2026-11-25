import type { Rgba } from "../formats/Dds.ts";
import { loadingPictures, type LoadingPicture } from "./frontEndArt.ts";
import { mountScreen, unmountScreen, type Screen } from "./Screen.ts";

/** Draw a decoded picture into a new canvas. */
function toCanvas(img: Rgba, className = ""): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.className = className;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}

/**
 * A dev tool: browse the original game's loading-screen pictures (read from the player's install; nothing is stored). A grid of thumbnails, click or
 * use the arrow keys to see one large, Escape to go back. The original shows exactly one of them, chosen at random, behind its progress bar.
 */
export class LoadingGalleryScreen implements Screen {
  private el: HTMLElement | null = null;
  private pictures: LoadingPicture[] = [];
  private decoded = new Map<string, Promise<Rgba>>();
  private current = -1;
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { if (this.current >= 0) this.close(); else this.onBack(); }
    else if (this.current >= 0 && e.key === "ArrowRight") this.open((this.current + 1) % this.pictures.length);
    else if (this.current >= 0 && e.key === "ArrowLeft") this.open((this.current + this.pictures.length - 1) % this.pictures.length);
  };

  constructor(private readonly container: HTMLElement, private readonly onBack: () => void) {}

  enter(): void {
    this.el = mountScreen(this.container, "menu gallery");
    this.el.innerHTML = `
      <h2>Loading screens</h2>
      <p class="note" role="status">Looking for the game files</p>
      <div class="grid" role="list"></div>
      <div class="viewer" hidden>
        <button type="button" class="nav prev" aria-label="Previous picture">‹</button>
        <figure><div class="stage"></div><figcaption></figcaption></figure>
        <button type="button" class="nav next" aria-label="Next picture">›</button>
        <button type="button" class="close" aria-label="Close picture">×</button>
      </div>
      <div class="actions"><button type="button" class="back">Back</button></div>`;
    const el = this.el;
    el.querySelector(".back")!.addEventListener("click", () => this.onBack());
    el.querySelector(".close")!.addEventListener("click", () => this.close());
    el.querySelector(".prev")!.addEventListener("click", () => this.open((this.current + this.pictures.length - 1) % this.pictures.length));
    el.querySelector(".next")!.addEventListener("click", () => this.open((this.current + 1) % this.pictures.length));
    window.addEventListener("keydown", this.onKey);
    void this.fill();
  }

  exit(): void {
    window.removeEventListener("keydown", this.onKey);
    if (this.el) { void unmountScreen(this.el); this.el = null; }
  }

  private decode(p: LoadingPicture): Promise<Rgba> {
    let d = this.decoded.get(p.name);
    if (!d) this.decoded.set(p.name, (d = p.load()));
    return d;
  }

  private async fill(): Promise<void> {
    const el = this.el;
    if (!el) return;
    this.pictures = await loadingPictures();
    if (!el.isConnected) return;
    const note = el.querySelector<HTMLElement>(".note")!;
    if (!this.pictures.length) {
      note.textContent = "No game files found. Open Load Game and pick your game folder first (or run the dev server with OTM_GAME_DIR set).";
      return;
    }
    note.textContent = `${this.pictures.length} pictures. The game picks one at random each time it loads.`;
    const grid = el.querySelector(".grid")!;
    this.pictures.forEach((p, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "thumb";
      b.setAttribute("role", "listitem");
      b.setAttribute("aria-label", `${p.name}, open large`);
      const label = document.createElement("span");
      label.textContent = p.name.replace(/^load_/, "");
      b.append(label);
      b.addEventListener("click", () => this.open(i));
      grid.append(b);
      // thumbnails decode one after another so the page stays responsive (each is 1024 x 1024)
      void this.decode(p).then((img) => { if (b.isConnected) b.prepend(toCanvas(img)); }).catch(() => { label.textContent += " (unreadable)"; });
    });
  }

  private open(i: number): void {
    const el = this.el;
    if (!el) return;
    this.current = i;
    const p = this.pictures[i]!;
    const viewer = el.querySelector<HTMLElement>(".viewer")!;
    viewer.hidden = false;
    el.querySelector("figcaption")!.textContent = `${p.name}  (${i + 1} / ${this.pictures.length})`;
    const stage = el.querySelector(".stage")!;
    stage.replaceChildren();
    void this.decode(p).then((img) => { if (this.current === i) stage.replaceChildren(toCanvas(img)); });
    el.querySelector<HTMLButtonElement>(".close")!.focus();
  }

  private close(): void {
    this.current = -1;
    this.el?.querySelector<HTMLElement>(".viewer")?.setAttribute("hidden", "");
  }
}
