// Room text placement and the floor-plan reveal rules (docs/ROOM_DISPLAY.md). The pure parts need no game files.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RULE, RevealTracker, distanceToPolygon, parseFloorplanRevealing, revealRule } from "../../src/sim/ui/FloorplanReveal.ts";
import { TEXT_HEIGHT, fitLine, lineStrips, roomHasNoText, roomTextLayout, textNeedsFlip } from "../../src/sim/ui/RoomText.ts";
import { haveGame, pakIndex } from "../helpers.ts";

test("wide rooms read along x from the left edge at mid height", () => {
  const l = roomTextLayout({ x: 10, y: 0 }, { x: 30, y: 8 });
  assert.deepEqual([l.anchor.x, l.anchor.y, l.size, l.rotation], [10, 4, 20, 0]);
});

test("tall rooms read down the y side from the top edge at mid width", () => {
  const l = roomTextLayout({ x: 0, y: 0 }, { x: 6, y: 20 });
  assert.deepEqual([l.anchor.x, l.anchor.y, l.size], [3, 20, 20]);
  assert.ok(Math.abs(l.rotation + Math.PI / 2) < 1e-9);
});

test("square rooms read along the diagonal, with the original's one-sided inset", () => {
  const l = roomTextLayout({ x: 0, y: 0 }, { x: 10, y: 10 });
  assert.deepEqual([l.anchor.x, l.anchor.y], [0, 10]);
  assert.ok(Math.abs(l.rotation + Math.PI / 4) < 1e-9);
  assert.ok(Math.abs(l.size - Math.hypot(8, 12)) < 1e-9); // quirk: (ex - 2, ey + 2)
});

test("hallways and the blank cosmetic-surgery room have no text", () => {
  assert.ok(roomHasNoText("room_so_hall") && roomHasNoText("room_hall") && roomHasNoText("room_cso_blank"));
  assert.ok(!roomHasNoText("room_ss_actors"));
});

test("a line is centred if it fits and shrunk to the strip if it does not", () => {
  const fits = fitLine(4, 10); // 4 x 1.5 = 6 wide in a strip of 10
  assert.deepEqual([fits.width, fits.height, fits.offsetAlong, fits.offsetAcross], [6, TEXT_HEIGHT, 2, 0]);
  const tight = fitLine(10, 7.5); // 15 wide, so shrunk by a half
  assert.ok(Math.abs(tight.width - 7.5) < 1e-9 && Math.abs(tight.height - 0.75) < 1e-9 && Math.abs(tight.offsetAcross - 0.375) < 1e-9);
});

test("text reading against screen-right is flipped; the two lines swap places when flipped", () => {
  assert.equal(textNeedsFlip({ x: 1, y: 0 }, { x: 1, y: 0 }, true), false);
  assert.equal(textNeedsFlip({ x: -1, y: 0 }, { x: 1, y: 0 }, true), true);
  assert.equal(textNeedsFlip({ x: 0, y: 1 }, { x: 1, y: 0 }, false), true); // square on: decided by the up side
  assert.deepEqual(lineStrips(1, false), [{ from: -0.75, to: 0.75 }]); // a single line is centred on the anchor line
  assert.deepEqual(lineStrips(2, false), [{ from: 0, to: 1.5 }, { from: -1.5, to: 0 }]);
  assert.deepEqual(lineStrips(2, true), [{ from: -1.5, to: 0 }, { from: 0, to: 1.5 }]);
});

const CSV = "#Mouse Pointer Content,,,,,\nrule_set,empty_cursor,,,staff,,\n#,Distance (m),Time (secs),Walls Reappear (m),Distance (m),Time (secs),Walls Reappear (m)\nfacility_gatehouse,0,2,10,2,0,7\n";

test("the reveal file gives a rule per facility and held thing", () => {
  const rules = parseFloorplanRevealing(CSV);
  assert.deepEqual(revealRule(rules, "facility_gatehouse"), { distance: 0, time: 2, reappear: 10 });
  assert.deepEqual(revealRule(rules, "facility_gatehouse", "staff"), { distance: 2, time: 0, reappear: 7 });
  assert.deepEqual(revealRule(rules, "no_such_building"), DEFAULT_RULE);
});

test("a floor plan shows after the pointer has dwelt, and hides beyond the reappear distance", () => {
  const t = new RevealTracker();
  const near = { key: "a", rule: { distance: 0, time: 2, reappear: 10 }, distance: 0 };
  assert.equal(t.update(1, [near]), null);
  assert.equal(t.update(1.1, [near]), "a");
  assert.equal(t.update(1, [{ ...near, distance: 9 }]), "a"); // still within the reappear distance
  assert.equal(t.update(1, [{ ...near, distance: 11 }]), null);
  assert.equal(t.update(5, [{ ...near, distance: 11 }]), null); // too far to start again
});

test("distance to a polygon: 0 inside, the edge distance outside", () => {
  const square = { verts: Float32Array.from([0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0]), tris: Uint16Array.from([0, 1, 2, 0, 2, 3]) };
  assert.equal(distanceToPolygon(square, 2, 2), 0);
  assert.ok(Math.abs(distanceToPolygon(square, 7, 2) - 3) < 1e-9);
  assert.ok(Math.abs(distanceToPolygon(square, 7, 8) - 5) < 1e-9);
});

test("the game's reveal file parses: gatehouse reveals after 2 s over it, hides at 10 m", { skip: haveGame ? false : "game archives not found (set OTM_PAK_DIR)" }, async () => {
  const bytes = await (await pakIndex()).readByName("floorplanrevealing.csv", { dir: "data\\floorplans\\" });
  const rules = parseFloorplanRevealing(new TextDecoder("latin1").decode(bytes!));
  assert.ok(rules.size >= 30);
  assert.deepEqual(revealRule(rules, "facility_gatehouse"), { distance: 0, time: 2, reappear: 10 });
  assert.deepEqual(revealRule(rules, "facility_gatehouse", "staff"), { distance: 2, time: 0, reappear: 7 });
});
