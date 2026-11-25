/**
 * The bar fixed to the top of the game scene: the title, the toolbar's slot and the Pause button (which opens the pause menu, as Esc does).
 * `toolbar` is the empty slot the toolbar buttons will be added to.
 */
export class MenuBar {
  readonly element: HTMLElement;
  /** Where the game's toolbar goes. */
  readonly toolbar: HTMLElement;

  constructor(onMenu: () => void) {
    const el = document.createElement("nav");
    el.className = "menubar";
    el.innerHTML = `<span class="brand">Open The Movies</span><div class="toolbar"></div><button type="button">Pause <kbd>Esc</kbd></button>`;
    this.element = el;
    this.toolbar = el.querySelector(".toolbar")!;
    el.querySelector("button")!.addEventListener("click", onMenu);
  }

  mount(parent: HTMLElement): void { parent.append(this.element); }
  dispose(): void { this.element.remove(); }
}
