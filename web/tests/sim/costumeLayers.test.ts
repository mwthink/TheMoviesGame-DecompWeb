// Costume variant names and the layer compositing (docs/CHARACTER_VIEWER.md).
import assert from "node:assert/strict";
import { test } from "node:test";
import { compositeLayers, isAlphaMap, variantOf, withVariant } from "../../src/sim/character/CostumeLayers.ts";

test("variant numbers in file names", () => {
  assert.equal(variantOf("com_m_50s_trousers_v02.dds"), 2);
  assert.equal(variantOf("com_m_50s_2_a.dds"), undefined);
  assert.equal(withVariant("com_f_cheer_main_v00.dds", 11), "com_f_cheer_main_v11.dds");
  assert.equal(withVariant("hat_m_gen_v04.msh", 0), "hat_m_gen_v00.msh");
  assert.equal(withVariant("com_m_50s_2_a.dds", 3), "com_m_50s_2_a.dds");
  assert.ok(isAlphaMap("com_m_50s_2_a.dds") && !isAlphaMap("com_m_50s_belt_v00.dds"));
});

test("layers paint over the atlas with their alpha", () => {
  const base = { width: 2, height: 1, data: new Uint8Array([100, 100, 100, 255, 100, 100, 100, 255]) };
  const layer = { width: 1, height: 1, data: new Uint8Array([200, 0, 0, 128]) };
  const out = compositeLayers(base, [layer]);
  assert.deepEqual([...out.data.slice(0, 4)], [150, 50, 50, 255]);
  assert.deepEqual([...out.data.slice(4, 8)], [150, 50, 50, 255]); // a smaller layer is stretched over the atlas
  assert.deepEqual([...base.data.slice(0, 3)], [100, 100, 100]); // the base is not changed
});
