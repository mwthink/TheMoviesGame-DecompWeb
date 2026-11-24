# `.msh` models

`tools/msh_dump.py <file.msh>...` prints what is decoded below. Meshes are in `meshscene0000/0001.pak`
(`tools/pak_extract.py extract "<game>/Data/pak" <dir> <name>.msh`). The layout comes from `LH_LoadMeshBinary` (`009deb10`) and
`FINDINGS.md` "`.msh` mesh format"; this note records what was **checked against real files**: 15 meshes (4 facilities, 7 ornaments, the lot gate,
the billboard, a hedge block) all parse to the end of the named parts with the layout below.

```
[zcmp]  "zcmp" + 16 bytes + a zlib stream (most files). The loader inflates this first. Plain files start at the header directly.
header  0x24 bytes. u32 version (always 10), u32 n_textures, u32 n_materials, u32 n_submeshes, 8 flag bytes at 0x10..0x17,
        then up to three u32 selected by control byte 0x16: bit 1 -> dword at 0x18, bit 6 -> next, bit 7 -> n_named_parts.
textures    n_textures x 32-byte NUL-padded file names (.dds), the real texture list of the model
materials   n_materials x 0x14 bytes (0x18 when byte 0xe & 4). Bytes 0..3 are texture indices (255 = none): [0] diffuse, [1] second layer
            (reflection/env/overlay), [2] lightmap (the `lm_*.dds` entries). u32 at 0x10 is a colour (ff969696 for props).
polygon chunks, each present when its flag bit is set, in this order: byte 0x13 != 0, 0x16 & 0x10, 0x16 & 8, 0x15 & 4, 0x16 & 4, 0x15 & 2, 0x16 & 1
            chunk = u16 n_verts, u16 ?, u16 n_tris, u16 ?, n_verts x (f32 x, y, z), n_tris x 3 x u16, padded to 4 bytes
named parts n_named_parts x (32-byte name + a polygon chunk): facilities have `room_`, `room_staff_hire_janitor`, `room_ss_starmaker`, `room_window` ...
submeshes   the render geometry (compact 16-byte quantized or 32-byte float vertices, FINDINGS.md): not parsed
```

## What the files show

* **Textures are not named after the model.** `p_hedge.msh` uses `hedge.dds`, `hedge_stone.dds`, `lm_hedge.dds`; the park bench uses `prop_bench.dds`;
  the gatehouse uses 31 textures (`grou_ph43k`, `wall_ph50*`, `palm_tree_02`, `lm_1940gates_00`, ...); the stage school 51 (including `land_grass00.dds`);
  the catering building 34; the billboard `advert_chrysler_3.dds` and `lm_osl_group_01.dds`; the trailer `lm_trailer2_0`, `envmap6`, `gen_mirrorwindow`, `fac_trailer6`, `gen_sky`.
  The same-stem `.dds` files (`fac_gatehouse.dds`, `p_hedge.dds`, 4-16 KB) are probably the UI thumbnails (the `.inf` files contain a `thumbnail` entry).
* **Chunks are simple polygon sets in model space** (x, y ground plane, z up, units are world units, model origin at the placement `POSITION`).
  They are collision/placement shapes, not render geometry. Seen in these meshes:
  * `flag13` (byte 0x13): a hull with height (z 0..~3-16): the solid body. Props have it, e.g. the hedge 4.0 x 0.7 x 0.7, palm tree 16 high.
  * `b15_02` (byte 0x15 bit 2): a flat polygon at z = 0 that hugs the base: hedge 3.7 x 0.74, flowerbed 2.2 x 2.2, pot plant 0.5 x 0.5, gatehouse ~18.7 x 13.6.
    **This is the placement footprint source** (traced in the code, see "Placement footprint in the code").
  * `b16_01` (byte 0x16 bit 0): a flat polygon, larger than the base (gatehouse 29 x 22): clearance/exclusion area?
  * `b16_10` (byte 0x16 bit 4): a small flat polygon above ground (the billboard's at z 1.59, the catering one at 0.6): not identified.
* **Named parts** are floor polygons at z ~0.01-0.03 for the rooms a facility is made of, in the same model space (gatehouse: `room_staff_fire`,
  `room_staff_hire_janitor`, `room_staff_hire_builder`; stage school: `room_ss_actors`, `room_ss_directors`, `room_ss_starmaker`, `room_ss_extras`, `room_ss_fire`).
  They match the room names in the save (`TMRoom`, `CHireRoom`, `CStarMakerRoom`).
* **Footprint vs the save's occupancy grid.** Rotating each chunk by the placed asset's `MyAngle` and testing it against the occupancy bitmap
  (`docs/SAVE_FORMAT.md`) does not select any one chunk: the gatehouse footprint has 0 of 80 cells set and the catering building 0 of 15, while the trailer's is fully set.
  So the bitmap in the save is not a record of where buildings stand.

## Not done

Submesh vertex and index data; the second `u16` in a chunk header; what the `u16`/flag bits 0x13 / 0x15 / 0x16 mean (names above are by flag bit, not by purpose);
which slot each of the two rasterizer passes in `FUN_009e8060` reads (the decompile lost the arguments); the meaning of the other chunks (`b16_01`, `b16_10`) and of the chunk header's two unknown `u16`s.

## Placement footprint in the code

Chunk slots on the loaded mesh object (set by `LH_LoadMeshBinary`): `+0x50` = `flag13` hull, `+0x5c` = `b15_02` flat polygon, `+0x60` = `b16_01`, `+0x54` = `b16_08`, `+0x58` = `b16_10`.

1. **Footprint source.** `FUN_0097fc60` (called by `FUN_00528060` for an asset's model, `0097fc60`) is the only place that picks a slot: it looks at `mesh+0x5c`
   first; if that is null it uses `mesh+0x50`, and if that is null too it **builds an axis-aligned box from the mesh bounds** into `+0x50` (`FUN_009e6e90`: 8 vertices, 12 triangles from
   the centre at `+0xc8..0xd0` and half-extents `+0xd4..0xdc`). So a mesh without a `b15_02` polygon (the large facilities all have one) gets a bounding box.
2. **Rasterizing.** `FUN_009e8060` projects the chosen polygon's triangles (`FUN_009e7c60`, one pass per chunk kind with fill values 2 and 3) into a byte bitmap at **0.5 world units per
   cell** (`origin = min * 0.5`) and returns it to the asset, which stores it at `CAsset + 0x3a0` as `{u8* data, rows, cols, origin_x (+0xc), origin_y (+0x10)}`.
   Bit 0 of a byte is "covered". `CAsset_DrawFootprintOverlay` (`005292e0`) draws exactly these cells (`cell = i * 0.5 + origin - 256`), and `CAsset_RefreshFootprintFlag`
   (`00528510`) re-tests the footprint whenever the asset moves.
3. **Placement test.** `FUN_0046d400(footprint, flagMask)` walks the footprint bitmap and, for every covered cell, asks the **lot cell grid** (`FUN_0046c5d0`)
   whether it is free; any covered cell that is not free fails the placement (and, if the debug flag is on, marks it). Masks seen: `0x41`, `0x3ff`, `0x2f`, `0xfffffc01`, `0xffffffd1`
   (`FUN_0046d730` sets/clears the asset's footprint flags in the grid with them).
4. **The lot cell grid** (`DAT_0104913c`, `DAT_01049130/34` = size, `FUN_0046cad0` converts world to cell) is finer than the 256 x 256 bitmap in the save: `FUN_00465650(gx, gy, on)`
   expands one saved 2-unit occupancy cell into the 0.5-unit sub-cells (a 4 x 4 block, flag masks `0x30`/`0x3e` and their complements) of that finer grid.
   `CLot_RefreshOccupancyGridForBounds` (`00465a50`) calls it for every bitmap bit that is set. So the saved bitmap is the **coarse, static "blocked" seed**; the live
   per-asset footprints are registered on the fine grid at runtime and are not in the save.

Not traced: the exact meaning of each flag bit in the cell grid's word, and the code that registers each placed asset's footprint on the grid.
