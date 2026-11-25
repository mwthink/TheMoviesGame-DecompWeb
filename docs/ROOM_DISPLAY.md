# Room floors: colours, text and when they show

How the game shows a building's rooms when the pointer reveals its floor plan, and what the web app does. Code: `web/src/world/RoomFloors.ts` (drawing),
`web/src/sim/ui/RoomText.ts` (text placement), `web/src/sim/ui/FloorplanReveal.ts` (the reveal rules), `GameView.updateHover` (the decision); tests `web/tests/sim/roomDisplay.test.ts`.
Evidence labels as in `CLAUDE.md`. The room list, names and the text strings are in `SAVE_FORMAT.md` ("The text on the floor").

## The room text [read]

`RoomPart_InitDrawingData` (orig `00A14BD0`) works the text's placement out once per room from the polygon's bounding box (`RoomPart_GetPolygonBounds`, `009E6D20`);
`RoomPart_Draw` (`00A157B0`) draws it every frame through `RoomPart_DrawTextLine` (`00A151A0`).

| What | Rule |
|---|---|
| Text height | 1.5 world units (the float at part + 0x80) for every room, however big |
| Which side | extents ex = maxX - minX, ey = maxY - minY. If \|1 - ex / ey\| >= 0.3 the text follows the long side: a wide room along x from its left edge at mid-height (rotation 0), a tall room down y from its top edge at mid-width (rotation -90 degrees). A roughly square room gets the diagonal from its top-left corner (rotation -45 degrees) |
| Length of the strip | the long extent; for the diagonal sqrt((ex - 2)^2 + (ey + 2)^2). **quirk:** x is inset by one unit each side but y is written `(minY - 1) - (maxY + 1)` = -(ey + 2); reproduced (`roomTextLayout`) |
| Fit | the line is scaled to 1.5 high; if it then fits the strip it is centred along it; if not the whole line shrinks to the strip's length and is centred across the 1.5 height (`fitLine`) |
| Flip | each frame the text is turned half way round when the camera would see it upside down (`param_2` of `RoomPart_DrawTextLine`: rotate by pi and offset by the text's size); `textNeedsFlip` compares the reading direction with the camera's screen-right |
| No text | a name containing `hall` (flag 4; the string at `00D6E9E8` is "hall") and `room_cso_blank`; `room_ss_starmaker` too while there is no star (a run-time condition) |
| One line | centred on the anchor line (a strip from -0.75 to +0.75). Read literally the original's strip runs 0 to 1.5 from the anchor, which showed single lines half a line above centre in the web app; the game shows them centred, so the strip is centred |
| Two lines | `ROOM_X` and `ROOM_X_2` (`SAVE_FORMAT.md`). [guess] The first line is the strip above the centre line and the second the one below it; the decompile does not show the second line's offset. When flipped they swap so the first stays on top |

The flags `0x80` (`_fire`, `_canit`: five preloaded strings by a run-time index), `0x100` (`room_prod_release`) and `0x400` (`room_preprod_extras`, `room_preprod_crew`) pick other texts; they are
not traced. Part flag `0x10` draws a small "floor marker" mesh at the text anchor (`DAT_010B944C`, loaded through `Mesh_LoadCached`); which mesh it is was not found.

## The room colours [data]

A room is not outlined: **the room's floor is tinted**. `TMRoom_SetHighlightHover` / `SetHighlightSelectable` / `SetHighlightSelected` / `ClearHighlight` (`0093C280`, `0093C2E0`, `0093B230`,
`0093C220`) call `Object_SetSubMeshColor` (`00980B20`) with a colour per room, read from the executable (ARGB constants at `00E66054..00E6606C`):

| State | RGB | |
|---|---|---|
| normal and hover | 178, 223, 252 | baby blue (the same for both) |
| selectable | 152, 197, 226 | a room that can take what is held |
| selected | 137, 253, 134 | light green; `TMRoom_PulseHighlight` (`0093B140`) scales it by \|sin(2 pi t / 20)\| |
| invalid | 255, 120, 120 | |
| disabled | 64, 73, 88 | |

The web app uses 178, 223, 252 for the floor (was a guessed 169, 212, 245). The dark-blue ink and wall outline are **not** from the game (nothing read draws an outline); they remain a guess
from how the game looks, so a wall outline may not belong at all.

## When the floor plan shows [data] [guess]

`data\floorplans\floorplanrevealing.csv` has, for each facility (`facility_gatehouse`, `facility_stage`, `trailer_1` ...) and each thing the pointer can hold (empty cursor, staff, crew,
writer, scientist, assistant, unhired, actor, director, extra, wannabe, the project states, placing), three numbers: **Distance (m)**, **Time (secs)**, **Walls Reappear (m)**. [guess] on what they
mean: reveal once the pointer has been within *distance* of the building for *time* seconds, hide when it is farther than *reappear*. Empty cursor: the gatehouse and stage reveal after 2 s
directly over them (distance 0) and hide at 10 m; the production building reveals within 3 m at once; staff in hand reveals the gatehouse at once within 2 m. The game reads it in
`CAsset_ShowFloorplanIfNeeded` (`00534D30`) and drops the rooms in with `CAsset_UpdateFloorplanFade` (`005313E0`: each room waits for its turn, then falls with gravity;
not ported: the web app cuts and shows at once).

The web app applies the empty-cursor row (`RevealTracker`): the distance is measured on the ground from the pointer to the building's footprint (`b15_02`), and a building under the
pointer counts as 0. Other held things need the pointer to hold something, which the app does not have yet.
