import type { SavedStaff } from "../formats/Jad.ts";

/** What the panel calls a person: stars are actors; crew are named after the staff slot group they belong to. */
export function roleLabel(p: Pick<SavedStaff, "cls" | "career">): string {
  if (p.cls === "CStar") return "Actor";
  switch (p.career) {
    case "staff": return "Crew";
    case "": return "Staff";
    default: return p.career.charAt(0).toUpperCase() + p.career.slice(1);
  }
}

/**
 * The staff viewer: a panel on the left, under the toolbar, listing the studio's people grouped by role. For now it is a read-only list of what the
 * saved game holds (name and role); mood, salary and the rest of the original's staff screen come later.
 */
export class StaffPanel {
  readonly element: HTMLElement;
  private collapsed = false;

  constructor(staff: SavedStaff[]) {
    const el = document.createElement("aside");
    el.className = "staffpanel";
    el.setAttribute("aria-label", "Staff");
    el.innerHTML = `<header><span>Staff <b class="count"></b></span><button type="button" data-tooltip="Show or hide the staff list." aria-label="Collapse staff panel">–</button></header><div class="body"></div>`;
    this.element = el;
    el.querySelector(".count")!.textContent = String(staff.length);
    const toggle = el.querySelector("button")!;
    toggle.addEventListener("click", () => {
      this.collapsed = !this.collapsed;
      el.classList.toggle("collapsed", this.collapsed);
      toggle.textContent = this.collapsed ? "+" : "–";
      toggle.setAttribute("aria-label", this.collapsed ? "Expand staff panel" : "Collapse staff panel");
    });

    const body = el.querySelector(".body")!;
    if (!staff.length) {
      body.innerHTML = `<p class="empty">Nobody is hired yet.</p>`;
      return;
    }
    const groups = new Map<string, SavedStaff[]>();
    for (const p of staff) {
      const role = roleLabel(p);
      let list = groups.get(role);
      if (!list) groups.set(role, (list = []));
      list.push(p);
    }
    const roles = [...groups.keys()].sort((a, b) => (a === "Actor" ? -1 : b === "Actor" ? 1 : a.localeCompare(b)));
    for (const role of roles) {
      const people = groups.get(role)!;
      const sec = document.createElement("section");
      const h = document.createElement("h4");
      h.textContent = `${role} (${people.length})`;
      const ul = document.createElement("ul");
      for (const p of [...people].sort((a, b) => a.name.localeCompare(b.name))) {
        const li = document.createElement("li");
        li.textContent = p.name || "(unnamed)";
        ul.append(li);
      }
      sec.append(h, ul);
      body.append(sec);
    }
  }

  mount(parent: HTMLElement): void { parent.append(this.element); }
  dispose(): void { this.element.remove(); }
}
