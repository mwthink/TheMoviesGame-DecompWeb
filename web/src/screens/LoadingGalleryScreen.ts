import type { Rgba } from "../formats/Dds.ts";
import type { Strings } from "../formats/Lhts.ts";
import { gameStrings, loadingPictures, type LoadingPicture } from "./frontEndArt.ts";
import { DEFAULT_LOADING_LAYOUT, LoadingView, type LoadingLayout } from "./LoadingView.ts";
import { parseTip, pickTip, tipKeys, type Tip } from "./loadingTips.ts";
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
 * The loading-screen lab (dev): browse the original game's loading pictures and tinker with the loading screen built on them. A grid of thumbnails; choosing one opens the
 * **lab**, a live preview of the real loading layout (`LoadingView`, the same view the loading screen uses) with controls for the picture, the tip, the progress bar (a fixed
 * value, an animation, or the sweeping bar), the text box (position, size, text size and colours, or our own panel drawn over the picture's) and how the picture fits the window.
 * Layout changes can be copied out as JSON to become new defaults. Escape closes the lab, then the page. The pictures are read from the player's install (nothing is stored).
 */
export class LoadingGalleryScreen implements Screen {
  private el: HTMLElement | null = null;
  private pictures: LoadingPicture[] = [];
  private strings: Strings | null = null;
  private decoded = new Map<string, Promise<Rgba>>();
  private current = -1;
  private view: LoadingView | null = null;
  private layout: LoadingLayout = structuredClone(DEFAULT_LOADING_LAYOUT) as LoadingLayout;
  private tip: Tip | null = null;
  private fraction: number | null = 0.4;
  private label = "Reading the saved game";
  private animating = false;
  private raf = 0;
  private animStart = 0;
  private readonly onKey = (e: KeyboardEvent) => {
    const typing = ["INPUT", "SELECT", "TEXTAREA"].includes((e.target as HTMLElement).tagName);
    if (e.key === "Escape") { if (this.current >= 0) this.close(); else this.onBack(); }
    else if (this.current >= 0 && !typing && e.key === "ArrowRight") this.open((this.current + 1) % this.pictures.length);
    else if (this.current >= 0 && !typing && e.key === "ArrowLeft") this.open((this.current + this.pictures.length - 1) % this.pictures.length);
  };

  constructor(private readonly container: HTMLElement, private readonly onBack: () => void) {}

  enter(): void {
    this.el = mountScreen(this.container, "menu gallery");
    this.el.innerHTML = `
      <h2>Loading screens</h2>
      <p class="note" role="status">Looking for the game files</p>
      <div class="grid" role="list"></div>
      <div class="lab" hidden></div>
      <div class="actions"><button type="button" class="back">Back</button></div>`;
    this.el.querySelector(".back")!.addEventListener("click", () => this.onBack());
    window.addEventListener("keydown", this.onKey);
    void this.fill();
  }

  exit(): void {
    window.removeEventListener("keydown", this.onKey);
    cancelAnimationFrame(this.raf);
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
    [this.pictures, this.strings] = await Promise.all([loadingPictures(), gameStrings()]);
    if (!el.isConnected) return;
    const note = el.querySelector<HTMLElement>(".note")!;
    if (!this.pictures.length) {
      note.textContent = "No game files found. Open Load Game and pick your game folder first (or run the dev server with OTM_GAME_DIR set).";
      return;
    }
    note.textContent = `${this.pictures.length} pictures. Pick one to open the lab.`;
    const grid = el.querySelector(".grid")!;
    this.pictures.forEach((p, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "thumb";
      b.setAttribute("role", "listitem");
      b.setAttribute("aria-label", `${p.name}, open in the lab`);
      const label = document.createElement("span");
      label.textContent = p.name.replace(/^load_/, "");
      b.append(label);
      b.addEventListener("click", () => this.open(i));
      grid.append(b);
      // thumbnails decode one after another so the page stays responsive (each is 1024 x 1024)
      void this.decode(p).then((img) => { if (b.isConnected) b.prepend(toCanvas(img)); }).catch(() => { label.textContent += " (unreadable)"; });
    });
  }

  /** Open the lab on picture `i`. The first time, it is built; after that only the picture changes. */
  private open(i: number): void {
    const el = this.el;
    if (!el) return;
    this.current = i;
    const lab = el.querySelector<HTMLElement>(".lab")!;
    if (lab.hidden) {
      lab.hidden = false;
      this.buildLab(lab);
    }
    const p = this.pictures[i]!;
    lab.querySelector("[data-picname]")!.textContent = `${p.name}  (${i + 1} / ${this.pictures.length})`;
    void this.decode(p).then((img) => { if (this.current === i) this.view?.setPicture(toCanvas(img)); });
  }

  private close(): void {
    this.current = -1;
    this.animating = false;
    cancelAnimationFrame(this.raf);
    const lab = this.el?.querySelector<HTMLElement>(".lab");
    if (lab) { lab.hidden = true; lab.textContent = ""; }
    this.view = null;
  }

  /** The preview and the control panel. */
  private buildLab(lab: HTMLElement): void {
    lab.innerHTML = `<div class="stage"></div><aside class="panel"></aside>`;
    this.view = new LoadingView();
    lab.querySelector(".stage")!.append(this.view.element);
    this.tip = pickTip(this.strings);
    this.view.setTip(this.tip);
    this.view.setProgress(this.fraction, this.label);
    this.view.setLayout(this.layout);
    const panel = lab.querySelector<HTMLElement>(".panel")!;

    const section = (title: string) => {
      const s = document.createElement("section");
      s.innerHTML = `<h4>${title}</h4>`;
      s.querySelector("h4")!.addEventListener("click", () => s.classList.toggle("closed"));
      panel.append(s);
      return s;
    };
    const row = (parent: HTMLElement, label: string, control: HTMLElement) => {
      const l = document.createElement("label");
      l.append(`${label} `, control);
      parent.append(l);
      return l;
    };
    const button = (text: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.addEventListener("click", onClick);
      return b;
    };
    const slider = (parent: HTMLElement, label: string, min: number, max: number, step: number, value: number, onChange: (v: number) => void) => {
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
      const out = document.createElement("output");
      const show = () => { out.textContent = Number(input.value).toFixed(step < 1 ? 3 : 0); };
      show();
      input.addEventListener("input", () => { show(); onChange(Number(input.value)); });
      const l = row(parent, label, out);
      l.classList.add("slider");
      l.append(input);
      return input;
    };
    const apply = () => this.view?.setLayout(this.layout);

    // Picture
    const pic = section("Picture");
    const name = document.createElement("p");
    name.className = "info";
    name.dataset.picname = "";
    pic.append(name);
    const nav = document.createElement("div");
    nav.className = "buttons";
    nav.append(
      button("‹ Previous", () => this.open((this.current + this.pictures.length - 1) % this.pictures.length)),
      button("Next ›", () => this.open((this.current + 1) % this.pictures.length)),
      button("Random", () => this.open(Math.floor(Math.random() * this.pictures.length))),
    );
    pic.append(nav);
    const fit = document.createElement("select");
    fit.innerHTML = `<option value="contain">Whole picture</option><option value="cover">Fill the window</option>`;
    fit.addEventListener("change", () => { this.layout.fit = fit.value as LoadingLayout["fit"]; apply(); });
    row(pic, "Fit", fit);

    // Tip
    const tips = section("Tip");
    const tipSel = document.createElement("select");
    const keys = this.strings ? tipKeys(this.strings) : [];
    tipSel.innerHTML = `<option value="">(no tip)</option>` + keys.map((k) => `<option value="${k}">${parseTip(k, this.strings!.get(k)!).heading || k}: ${parseTip(k, this.strings!.get(k)!).body.slice(0, 28)}…</option>`).join("");
    const setTip = (t: Tip | null) => { this.tip = t; tipSel.value = t?.key ?? ""; this.view?.setTip(t); };
    tipSel.addEventListener("change", () => setTip(tipSel.value && this.strings ? parseTip(tipSel.value, this.strings.get(tipSel.value)!) : null));
    row(tips, "Tip", tipSel);
    tips.append(button("Random tip", () => setTip(pickTip(this.strings))));
    tipSel.value = this.tip?.key ?? "";

    // Progress
    const prog = section("Progress bar");
    const bar = slider(prog, "Value", 0, 1, 0.01, this.fraction ?? 0.4, (v) => { this.fraction = v; this.view?.setProgress(v, this.label); });
    const sweep = document.createElement("input");
    sweep.type = "checkbox";
    sweep.addEventListener("change", () => { this.fraction = sweep.checked ? null : Number(bar.value); this.view?.setProgress(this.fraction, this.label); });
    row(prog, "Sweeping bar (length unknown)", sweep).classList.add("check");
    const anim = document.createElement("input");
    anim.type = "checkbox";
    anim.addEventListener("change", () => {
      this.animating = anim.checked;
      if (anim.checked) { this.animStart = performance.now(); this.raf = requestAnimationFrame(tick); } else cancelAnimationFrame(this.raf);
    });
    row(prog, "Animate 0 to 100 %", anim).classList.add("check");
    const tick = (now: number) => {
      if (!this.animating) return;
      const v = ((now - this.animStart) / 8000) % 1;
      this.fraction = v;
      bar.value = String(v);
      sweep.checked = false;
      this.view?.setProgress(v, this.label);
      this.raf = requestAnimationFrame(tick);
    };
    const text = document.createElement("input");
    text.type = "text";
    text.value = this.label;
    text.addEventListener("input", () => { this.label = text.value; this.view?.setProgress(this.fraction, this.label); });
    row(prog, "Step text", text);

    // Layout
    const lay = section("Text box");
    const box = this.layout.box;
    slider(lay, "Left", 0, 1, 0.005, box.x, (v) => { box.x = v; apply(); });
    slider(lay, "Top", 0, 1, 0.005, box.y, (v) => { box.y = v; apply(); });
    slider(lay, "Width", 0.1, 1, 0.005, box.width, (v) => { box.width = v; apply(); });
    slider(lay, "Height", 0.1, 1, 0.005, box.height, (v) => { box.height = v; apply(); });
    slider(lay, "Text size", 0.5, 2, 0.05, this.layout.textScale, (v) => { this.layout.textScale = v; apply(); });
    const colour = (label: string, key: "headingColour" | "bodyColour") => {
      const input = document.createElement("input");
      input.type = "color";
      input.value = this.layout[key];
      input.addEventListener("input", () => { this.layout[key] = input.value; apply(); });
      row(lay, label, input);
    };
    colour("Heading colour", "headingColour");
    colour("Body colour", "bodyColour");

    const own = section("Our own panel");
    const f = this.layout.ownFill;
    const ownOn = document.createElement("input");
    ownOn.type = "checkbox";
    ownOn.checked = f.enabled;
    ownOn.addEventListener("change", () => { f.enabled = ownOn.checked; apply(); });
    row(own, "Draw it over the picture's box", ownOn).classList.add("check");
    const fillColour = document.createElement("input");
    fillColour.type = "color";
    fillColour.value = f.colour;
    fillColour.addEventListener("input", () => { f.colour = fillColour.value; apply(); });
    row(own, "Colour", fillColour);
    slider(own, "Opacity", 0, 1, 0.05, f.opacity, (v) => { f.opacity = v; apply(); });
    slider(own, "Corner radius", 0, 8, 0.25, f.radius, (v) => { f.radius = v; apply(); });

    const later = section("Coming later");
    const three = document.createElement("input");
    three.type = "checkbox";
    three.disabled = true;
    row(later, "Real-time 3D character in place of the picture's", three).classList.add("check");
    later.append(Object.assign(document.createElement("p"), { className: "info", textContent: "The pictures' characters are baked in; this will draw our own people on the left with the logo and box separate." }));

    const actions = document.createElement("div");
    actions.className = "buttons";
    actions.append(
      button("Reset layout", () => { const at = this.current; this.close(); this.layout = structuredClone(DEFAULT_LOADING_LAYOUT) as LoadingLayout; this.open(at); }),
      button("Copy layout as JSON", () => { void navigator.clipboard?.writeText(JSON.stringify(this.layout, null, 2)); }),
      button("Close", () => this.close()),
    );
    panel.append(actions);
  }
}
