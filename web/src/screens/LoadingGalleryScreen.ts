import type { Rgba } from "../formats/Dds.ts";
import type { Strings } from "../formats/Lhts.ts";
import { gamePak, gameStrings, loadingPictures, type LoadingPicture } from "./frontEndArt.ts";
import { DEFAULT_CHARACTER, LoadingCharacter, type CharacterSettings } from "./LoadingCharacter.ts";
import { DEFAULT_LOADING_LAYOUT, LoadingView, logoFromPicture, type LoadingLayout } from "./LoadingView.ts";
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
  /** The 3D character layer (made the first time it is switched on) and its settings; the logo cut-out switch and the current picture's pixels. */
  private char: LoadingCharacter | null = null;
  private character: CharacterSettings = { ...DEFAULT_CHARACTER };
  private showLogo = true;
  private pictureImg: Rgba | null = null;
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
    void this.decode(p).then((img) => { if (this.current === i) { this.pictureImg = img; this.view?.setPicture(toCanvas(img)); this.refreshLogo(); } });
  }

  private close(): void {
    this.current = -1;
    this.animating = false;
    cancelAnimationFrame(this.raf);
    const lab = this.el?.querySelector<HTMLElement>(".lab");
    if (lab) { lab.hidden = true; lab.textContent = ""; }
    this.view = null;
    this.char?.dispose();
    this.char = null;
  }

  /** The logo cut out of the picture is shown only when the background is not the picture (which has its own). */
  private refreshLogo(): void {
    const wanted = this.showLogo && this.layout.background !== "picture" && this.pictureImg;
    this.view?.setLogo(wanted ? logoFromPicture(this.pictureImg!) : null);
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
    const bg = document.createElement("select");
    bg.innerHTML = `<option value="picture">The picture as it is</option><option value="blurred">Blurred (hides its character)</option><option value="dark">Plain dark</option>`;
    bg.addEventListener("change", () => { this.layout.background = bg.value as LoadingLayout["background"]; apply(); this.refreshLogo(); });
    row(pic, "Background", bg);
    const logoBox = document.createElement("input");
    logoBox.type = "checkbox";
    logoBox.checked = this.showLogo;
    logoBox.addEventListener("change", () => { this.showLogo = logoBox.checked; this.refreshLogo(); });
    row(pic, "Logo cut out of the picture (when the background is not the picture)", logoBox).classList.add("check");

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

    // The 3D character: a transparent canvas between the background and the text box.
    const ch = section("3D character");
    const pakPromise = gamePak();
    const applyCharacter = async () => {
      const pak = await pakPromise;
      const view = this.view;
      if (!pak || !view) return;
      if (this.character.enabled && !this.char) this.char = new LoadingCharacter(pak, view.element, view.boxElement);
      await this.char?.set(this.character);
    };
    const chOn = document.createElement("input");
    chOn.type = "checkbox";
    chOn.addEventListener("change", () => { this.character.enabled = chOn.checked; void applyCharacter(); });
    row(ch, "Show a 3D character", chOn).classList.add("check");
    const sideSel = document.createElement("select");
    sideSel.innerHTML = `<option value="left">Left</option><option value="right">Right</option>`;
    sideSel.addEventListener("change", () => { this.character.side = sideSel.value as CharacterSettings["side"]; void applyCharacter(); });
    row(ch, "Side of the screen", sideSel);
    const costumeSel = document.createElement("select");
    const clipSel = document.createElement("select");
    void pakPromise.then((pak) => {
      if (!pak) return;
      const names = (dir: string, test: RegExp) => pak.list(dir).map((f) => f.entry.name).filter((n) => test.test(n));
      const fillSel = (sel: HTMLSelectElement, values: string[], value: string) => {
        sel.textContent = "";
        for (const v of values) sel.append(new Option(v, v));
        sel.value = values.includes(value) ? value : values[0] ?? "";
      };
      fillSel(costumeSel, names("data\\costume\\datas\\", /\.cos$/i), this.character.costume);
      fillSel(clipSel, names("data\\animations\\high\\", /^(idle|wait|talk|wave|stand|clap|think|actor_|dir_|coach_)[a-z0-9_]*\.anm$/i).slice(0, 250), this.character.clip);
    });
    costumeSel.addEventListener("change", () => { this.character.costume = costumeSel.value; void applyCharacter(); });
    clipSel.addEventListener("change", () => { this.character.clip = clipSel.value; void applyCharacter(); });
    row(ch, "Costume", costumeSel);
    row(ch, "Animation", clipSel);
    ch.append(button("Random costume", () => {
      const opts = [...costumeSel.options];
      if (!opts.length) return;
      costumeSel.value = opts[Math.floor(Math.random() * opts.length)]!.value;
      this.character.costume = costumeSel.value;
      void applyCharacter();
    }));
    slider(ch, "Size", 0.3, 1.2, 0.01, this.character.size, (v) => { this.character.size = v; void applyCharacter(); });
    slider(ch, "Nudge across", -0.3, 0.3, 0.005, this.character.nudgeX, (v) => { this.character.nudgeX = v; void applyCharacter(); });
    slider(ch, "Nudge up", -0.2, 0.3, 0.005, this.character.nudgeY, (v) => { this.character.nudgeY = v; void applyCharacter(); });
    slider(ch, "Turn", -180, 180, 1, this.character.turn, (v) => { this.character.turn = v; void applyCharacter(); });
    ch.append(Object.assign(document.createElement("p"), { className: "info", textContent: "The character is drawn behind the text box. Over the picture as it is, its own baked character shows too: choose Blurred or Plain dark above to replace it." }));

    const later = section("Coming later");
    later.append(Object.assign(document.createElement("p"), { className: "info", textContent: "Costume layers, makeup and hair colour (as on people in the world), hair choice, expressions, and a moving camera." }));

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
