/**
 * The text the game writes on a room's floor: where it goes, how big it is, which way it reads (docs/ROOM_DISPLAY.md). Plain numbers in and out.
 *
 * [read] orig 0x00A14BD0 `RoomPart_InitDrawingData` works the placement out once from the room polygon's bounding box; orig 0x00A157B0 `RoomPart_Draw` draws it each frame
 * through 0x00A151A0 `RoomPart_DrawTextLine` (fit and flip). Coordinates are the model's (x, y on the ground), as in the `.msh` room parts.
 */

export interface RoomTextLayout {
  /** Where the line's strip starts (its lower-left corner before rotation). */
  anchor: { x: number; y: number };
  /** The length of the strip the text must fit in. */
  size: number;
  /** The strip's direction, radians counter-clockwise from +x. */
  rotation: number;
}

/** How tall a line of text is, in world units (the float at part + 0x80, set to 1.5 by `RoomPart_InitDrawingData`). */
export const TEXT_HEIGHT = 1.5;

/**
 * `RoomPart_InitDrawingData`, the layout half. With extents ex = maxX - minX and ey = maxY - minY:
 *   - a room clearly longer in x or in y (|1 - ex / ey| >= 0.3) gets its text along the long side: wide rooms along x from the left edge at mid-height (rotation 0), tall rooms
 *     down the y side from the top edge at mid-width (rotation -90 degrees);
 *   - a roughly square room gets the text along the diagonal from its top-left corner (rotation -45 degrees), of length sqrt((ex - 2)^2 + (ey + 2)^2).
 * quirk: the diagonal's length adds 2 to ey where it subtracts 2 from ex: the code insets the box by one unit on each side for x (`(maxX - 1) - (minX + 1)`) but writes
 * `(minY - 1) - (maxY + 1)` for y, which is -(ey + 2). Reproduced as read; a fix would use ey - 2.
 */
export function roomTextLayout(min: { x: number; y: number }, max: { x: number; y: number }): RoomTextLayout {
  const ex = max.x - min.x;
  const ey = max.y - min.y;
  if (Math.abs(1 - ex / ey) >= 0.3) {
    if (ey <= ex) return { anchor: { x: min.x, y: min.y + ey / 2 }, size: ex, rotation: 0 };
    return { anchor: { x: min.x + ex / 2, y: max.y }, size: ey, rotation: -Math.PI / 2 };
  }
  return { anchor: { x: min.x, y: max.y }, size: Math.hypot(ex - 2, ey + 2), rotation: -Math.PI / 4 };
}

/** Rooms with no text: any whose name contains `hall` (the first flag test of `RoomPart_InitDrawingData`, flag 4; the string at 0x00D6E9E8 is "hall"), and `room_cso_blank`. */
export function roomHasNoText(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("hall") || n === "room_cso_blank";
}

/** Where one line sits inside its strip. */
export interface LineFit {
  /** The text's width and height in world units after fitting. */
  width: number;
  height: number;
  /** The offset of the text inside the strip (along it, and across it). */
  offsetAlong: number;
  offsetAcross: number;
}

/**
 * `RoomPart_DrawTextLine`'s fit. The text is first scaled to `TEXT_HEIGHT`; if its width then fits the strip (`size`) it is centred along it; if not, the whole line shrinks to
 * the strip's width and is centred across the strip's height. `aspect` is the text's width over its height at any size.
 */
export function fitLine(aspect: number, size: number): LineFit {
  const width = aspect * TEXT_HEIGHT;
  const ratio = width / size;
  if (ratio <= 1) return { width, height: TEXT_HEIGHT, offsetAlong: (size - width) / 2, offsetAcross: 0 };
  const shrink = 1 / ratio;
  return { width: size, height: TEXT_HEIGHT * shrink, offsetAlong: 0, offsetAcross: (TEXT_HEIGHT - TEXT_HEIGHT * shrink) / 2 };
}

/**
 * Whether the text must be turned half way round to read the right way up from the camera (the `param_2` flip of `RoomPart_DrawTextLine`, chosen each frame from the
 * camera's angle). `read` is the text's reading direction on the ground and `right` the camera's screen-right direction, both in the same ground coordinates; text reading
 * against screen-right is flipped. A direction square on to the camera (reading toward or away from it) is decided by whether the text's up side faces away.
 */
export function textNeedsFlip(read: { x: number; y: number }, right: { x: number; y: number }, upAwayFromCamera: boolean): boolean {
  const d = read.x * right.x + read.y * right.y;
  if (Math.abs(d) < 1e-3) return !upAwayFromCamera;
  return d < 0;
}

/**
 * The lines of a room's text as strips across the anchor line. One line is centred on it (a strip from -0.75 to +0.75): read literally, the original's strip runs 0 to 1.5
 * from the anchor, which put single lines 0.75 units above the room's middle in the web app, and the game shows them centred. Two lines are stacked about it, the first above and
 * the second below; turned half way round (`flipped`) they swap so the first line is still the upper one for the viewer. [guess] The stacking: the decompile does not show how
 * the second line is offset.
 */
export function lineStrips(lineCount: number, flipped: boolean): { from: number; to: number }[] {
  const above = { from: 0, to: TEXT_HEIGHT };
  const below = { from: -TEXT_HEIGHT, to: 0 };
  if (lineCount <= 1) return [{ from: -TEXT_HEIGHT / 2, to: TEXT_HEIGHT / 2 }];
  return flipped ? [below, above] : [above, below];
}
