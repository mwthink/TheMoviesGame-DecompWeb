# The sky

Where the game's sky comes from, and how the web app draws it. Code: `web/src/world/WorldData.ts` (`loadSky`), `web/src/world/WorldScene.ts` (`buildSky`),
`web/src/world/Sky.ts` (the era rule); tests `web/tests/sim/sky.test.ts`, `sun.test.ts`. Evidence labels as in `CLAUDE.md`.

## What the game does [read] [data]

- **One model, `Sky_box.msh`** (10 KB, `data\meshes\`), loaded with `Mesh_LoadCached("Sky_box.msh")` by `Landscape_LoadOutsideLotAndSky` (orig `009CC160`) right after the surroundings
  list `OutsideLot_high.rob` / `_low.rob` (`WEB.md`). It becomes a 0x110-byte object (`DAT_0105CDFC`). The loader re-flags the model's `land_sand00` and `land_tarmac00` materials.
- **Its geometry** (game units, z up): four curved **sky walls** about 980 units from the origin (`sky_01`..`sky_04`, 25 vertices each, from z -59 to 240), a **top cap** (`sky_top.dds`, 89
  vertices, z 240 to 522) and a flat **ground plane** 2200 units across at z 0 (`land_sand00.dds` with the lightmap `lm_sky.dds`, which is an uncompressed 128 x 128 24-bit image).
- **Three variants of each sky wall:** `sky_NN_v00.dds`, `_v01`, `_v02` (1024 x 512 DXT1). They are **eras of the game's calendar, not times of day.** `Landscape_UpdateEraVariant` (`009CBA90`) reads
  the **current game year**: `DAT_0105BEA4` is a callback set at boot (`Game_Bootstrap`, `00428E07`) to the thunk at `0041FC60`, which calls `Time_ToYears` (`0043B710`, the date times 1/365) on the
  global game clock (`0x00E4FA4C`); with no callback the year defaults to 2000.0. The year is clamped to at least 1900 and `round((year - 1900) * 0.1)` (32-bit floats, round to nearest even) gives a
  decade index; the variant is **0 for an index up to 5 (years before 1955), 1 for 6 to 9 (1955 to 1994), 2 from 10 (1995 on)**. On a change `Landscape_ApplySkyVariantTextures` (`009CAE20`) swaps the four
  walls' textures (`sky_%02d_v%02d.dds`) and the landscape objects use `%s_v%02d.dds` the same way. A second function, `Landscape_GetEraIndexByYear` (`009CBC40`), buckets the same year at 1929, 1940, 1950,
  1955, 1967 and 2001 (an era index -1 to 5) for other landscape art.
- The game camera's far plane is 300 (`FAR_PLANE`) while the sky box is 980 across, so the game must draw the sky some other way (centred on the camera, or scaled); it was not read.

## The web app

- The sky is built from the same model: the four walls and the top cap are **scaled to a fifth** (so they sit inside the 300-unit far plane), drawn unlit with the variant's textures,
  and follow the camera (`infiniteDistance`); the sand plane keeps its size, sits 0.6 units below the terrain, and shows beyond the terrain's edge, lit like the other models
  (`lm_sky` as its lightmap, so the sun, shadows and debug views apply to it).
- **Variant:** `skyVariantForYear(yearOfDate(clock.date))`, as the game does it: a Quick Start save in 1960 shows variant 1, a fresh 1920 studio variant 0. The dev menu's **Sky** section can force a variant or follow the game's year (the default; a game year is about 12 minutes at 1x, so the sky changes era rarely).
- Not done: the landscape objects' own `_v0N` textures, a fog or horizon blend, and how the original keeps the sky inside its far plane.
