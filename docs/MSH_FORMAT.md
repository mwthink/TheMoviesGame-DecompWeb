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
    **Best candidate for the placement footprint, not verified.**
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
version-2 `.flm` links; whether anything in the loader reads the chunks for placement (`this+0x5c` is the `b15_02` slot, `this+0x50` is `flag13`).
