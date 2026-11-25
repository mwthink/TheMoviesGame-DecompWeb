# Tooltips

How the original shows tooltip text and what the web app does (`web/src/ui/Tooltip.ts`, `web/tests/sim/tooltip.test.ts`). Evidence labels as in `CLAUDE.md`.

## The original [read]

There is **one tooltip window** (`WToolTip`, singleton `DAT_0104e104`), not one per control.

| Function | Name | What it does |
|---|---|---|
| `00740DC0` | `WWindow_SetTooltipText` | Any window can carry tooltip text (`WWindow +0x2d8`, flag `+0x114 |= 1`); the front end sets them for the back, quit, quick-start and continue buttons (`FRONTEND.md`), the release screen for its bars and tabs (`RELEASE_TOOLTIP_*`), StarMaker for its sliders (`SM_TOOLTIP_*`) |
| `0073ADE0` | `WToolTip_Constructor` | Builds the window: an HTML child holding the text over the `ui/tooltip2.dds` backdrop; state `DAT_0104e0e4` = 0 |
| `0073B4A0` | `Tooltip_Show` | Takes the singleton, sets its text and anchor (the pointer, or a given point), shows it |
| `0073B440` | `WToolTip_Tick` | Per UI tick: counts the show delay (`+0x364`) down, then shows it; global state `DAT_0104e0e4`: 0 idle, 1 pending, 3 shown |
| `0073B200` | `WToolTip_PositionAndSize` | If the text is wider than the room left on screen it is wrapped in an HTML table `0.9 x (screen width - x - 20)` wide; the window sits at the anchor + (12, 12) |
| `0078EB40` | `Tooltip_UpdateHoverStillnessFade` | Per UI tick: if the pointer has not moved since the last tick a value rises by 0.1 up to 1.0; if it moved it restarts at -0.2. The tooltip is invisible while the value is below 0 and fades in with it |

Other tooltip-like things the original has and the web app does not yet: `CBubbleToolTip` / `CToolTipAnchor*` (speech-bubble tips with an arrow, anchored to a window or
a timeline item, used by the tutorial), the `WToolTipProject*` windows (rich project tooltips with people and schedules), `CSITTToolTip` (tutorial tips) and
`ViewportTooltip` (hover text for things in the 3D view).

## The web app

- Text rides on the element: `data-tooltip="..."` (the equivalent of `WWindow_SetTooltipText`). `Tooltip.attach` listens for the pointer.
- The **stillness rule is ported exactly** (`HoverStillness`): the UI ticks at 10 Hz, so the tip appears after 0.2 s of a still pointer and is fully opaque after 1.2 s.
- The text wraps to 90 % of the room left on screen (`tooltipWidth`).
- **Deviation (as asked):** it is a bubble at the bottom right, not beside the pointer; a click on it dismisses it until the pointer is over a different target.
- `Tooltip.show(text)` is for things that are not elements: hovering a person in the 3D view shows their name (and "star" or "wannabe").
- Not ported: the HTML body (bold, line breaks), the `tooltip2.dds` look, the per-window show delay `+0x364` (not read).
