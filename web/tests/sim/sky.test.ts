// The sky box: its model and every texture it needs decode (docs/SKY.md).
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeDds } from "../../src/formats/Dds.ts";
import { parseMsh } from "../../src/formats/Msh.ts";
import { findTexture } from "../../src/world/WorldData.ts";
import { haveGame, pakIndex } from "../helpers.ts";

test("Sky_box.msh has four sky walls, a top cap and a sand plane, and every texture of every variant decodes", { skip: haveGame ? false : "game archives not found (set OTM_PAK_DIR)" }, async () => {
  const pak = await pakIndex();
  const m = parseMsh((await pak.readByName("sky_box.msh"))!);
  assert.equal(m.primitives.length, 6);
  const names = new Set(m.textures.map((t) => t.toLowerCase()));
  for (const t of [...names]) { const x = /^(sky_\d\d)_v00\.dds$/.exec(t); if (x) for (const v of ["v01", "v02"]) names.add(`${x[1]}_${v}.dds`); }
  assert.ok(names.size >= 14, `${names.size} textures`);
  for (const n of names) {
    const f = findTexture(pak, n);
    assert.ok(f, `${n} is in the archives`);
    const img = decodeDds(await pak.read(f));
    assert.ok(img.width >= 64 && img.height >= 64, n);
  }
  // the sky walls surround the lot: about 980 units out, from below the ground up to the top cap
  const widest = Math.max(...m.primitives.flatMap((p) => Array.from(p.positions.filter((_, i) => i % 3 === 0), Math.abs)));
  assert.ok(widest > 900 && widest < 1200, `${widest}`);
});
