// The loading-screen pictures the gallery lists (docs/LOADING_SCREENS.md).
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeDds } from "../src/formats/Dds.ts";
import { haveGame, pakIndex } from "./helpers.ts";

test("the archives hold 17 loading pictures of 1024 x 1024", { skip: haveGame ? false : "game archives not found (set OTM_PAK_DIR)" }, async () => {
  const pak = await pakIndex();
  const list = pak.list("data\\textures\\ui\\loadingscreens\\");
  assert.equal(list.length, 17);
  assert.ok(list.every((f) => /^load_.*\.dds$/.test(f.entry.name)));
  const img = decodeDds(await pak.read(list[0]!));
  assert.deepEqual([img.width, img.height], [1024, 1024]);
});
