/** A full-window DOM screen (splash, menu). The game view is the canvas, handled by GameView. */
export interface Screen {
  /** Called when the screen becomes the current one. */
  enter(): void;
  /** Called when it stops being the current one. Remove timers and listeners here. */
  exit(): void;
}

/** Create a `.screen` element, add it to the container and fade it in on the next frame. */
export function mountScreen(container: HTMLElement, className: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `screen ${className}`;
  container.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("visible")));
  return el;
}

/** Fade out, then remove. Resolves when the element is gone. */
export function unmountScreen(el: HTMLElement): Promise<void> {
  el.classList.remove("visible");
  return new Promise((resolve) => {
    const done = () => { el.remove(); resolve(); };
    el.addEventListener("transitionend", done, { once: true });
    setTimeout(done, 700); // fallback if no transition runs (hidden tab, reduced motion)
  });
}
