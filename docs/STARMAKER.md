# StarMaker.exe (the character editor)

Status: the editor's star format, face sliders, facial expressions and makeup / hair / iris handling are decoded, reproduced and tested; see the index below. What is still open is listed at the end of section 10 (looks) and in section 11 (body and costume textures). In the reimplementation StarMaker becomes a screen of the game reached from the main menu, not a separate program (`STATUS.md`).

| Question | Where | Tool / code |
|---|---|---|
| What is StarMaker, how it was compared with the game | sections 1 to 3 | `ghidra/scripts/FunctionHashes.java`, `tools/match_binaries.py` |
| The star file `info.sm`, `star.hd`, `thumb.dds` | sections 6, 10 | `web/src/sim/character/StarFile.ts`, `HeadFile.ts` |
| The 43 face sliders | section 7 | `tools/starmaker_sliders.py`, `web/src/sim/character/FaceRig.ts` |
| Facial expressions (`.fan`, `fclexp`) | section 8 | `tools/render_expression.py`, `render_expression_gif.py`, `FaceRig` |
| Makeup, hair, iris, age, blends, weight; all function names | sections 9, 10 | `tools/render_star.py`, `render_star_sheet.py`, `web/src/sim/character/Appearance.ts`, `tools/starmaker_names.csv` |
| Body / costume texture compositing, `.cos` records, `InfoTextures.fas` | section 11 | (research only, no tool yet) |
| Finding code from a string | `docs/ANALYSIS_TOOLS.md` | `ghidra/scripts/FindRefs.java` |

Items are marked **[read]** (read in the decompiled code or disassembly), **[data]** (seen in the game's data files or the binary's strings) or **[guess]**.

## 1. What it is

* `StarMaker.exe`, 3,469,312 bytes, next to `MoviesSE.exe` in the game folder. PE32 x86, built 2006-03-28 (MoviesSE: 2006-04-26). Same section layout (.text, .rdata, .data, _PDATA, .rsrc).
  PDB path in the file: `C:\movies\dev\Tools\StarMaker\Gold\StarMaker.pdb`; the string `StarMaker v1.0 Lionhead Studios 2005`. **[data]**
* Imports KERNEL32, USER32, GDI32, SHELL32, WMVCore, WINMM, MSACM32, WS2_32, SHFOLDER, ADVAPI32, ole32 (MoviesSE has no WMVCore, and has OLEAUT32). No Direct3D import: like the game it loads the 3D libraries at run time.
* It is a stripped build of **the same engine**: 85 RTTI classes, all of which also exist in MoviesSE (none are unique), mostly the file/streaming layer (`MV::MyAsyncFile`, `MyAsyncMesh`, `MyAsyncTexture`), the FX classes, the input manager, DirectShow base classes for capture
  (`CMoviesVideoFilter`, `CMoviesAudioFilter`), `MV::Object`, `MV::MultiSprite`, and `FS::CBase` / `FS::CObject` (the scene classes). The editor's own UI has no RTTI classes. **[data]**
* Data: `Data\StarMaker\starmaker.ini` (face slider table), `starmaker.lhts` (UI text, keys `SM_*`; `tools/lhts.py` reads it), `Doc.txt` (the help text). Saved stars go to `Documents\The Movies\StarMaker\`. **[data]**
* What the program does (from `Doc.txt` and the strings): create a male or female star, pick a head and a second head and **blend** them (head shape and skin tone sliders), eye colour, an age slider, hairstyle and hair colour, eyebrows, eye makeup, facial hair and lipstick,
  an advanced mode with 43 face sliders, a "Star Information" page that spends points on attributes, save/load/delete of stars. In the main game a star is brought in through an "Import Star" room of the Stage School, which only opens once a star has been saved. **[data]**

* The game and the editor do not run together: `Game_CheckStarMakerNotRunning` (`00542aa0`) checks the `"LionheadStudiosTheStarMaker"` mutex
  (`CreateMutexA`). `Game_InitUserDataFolders` (`0056bd80`) creates the `Documents\The Movies\` folder tree, `Starmaker\` included. **[read]**

## 2. How the analysis was done (reproducible)

Ghidra 12.1.2 headless, with StarMaker in a Ghidra project of its own (`data/ghidra/StarMaker`, project name `StarMaker`; `SETUP.md` builds it), so the main project is not touched. Scripts in `ghidra/scripts/`:

```
analyzeHeadless data/ghidra/StarMaker StarMaker -import "<game>/StarMaker.exe" -scriptPath ghidra/scripts -postScript FunctionHashes.java <out.tsv>
analyzeHeadless data/ghidra/MoviesSE TheMovies -process MoviesSE.exe -noanalysis -readOnly -scriptPath ghidra/scripts -postScript FunctionHashes.java <main.tsv>   # use a copy of the project
analyzeHeadless data/ghidra/StarMaker StarMaker -process StarMaker.exe -noanalysis -readOnly -scriptPath ghidra/scripts \
    -postScript DecompileAddrs.java <out.txt> <addr> [<addr>...] [--callers] [--asm]
```

* `FunctionHashes.java`: one line per non-thunk function: address, size, instruction count, name, `h_mnem` (hash of the mnemonic sequence), `h_norm` (mnemonics plus operands, with every address operand and every number of at least 0x100000 replaced by `A`), call count and up to six string literals.
* `DecompileAddrs.java`: C for chosen functions, optionally their callers, optionally the disassembly (needed because the decompiler loses float arguments pushed on the stack, in both binaries).
* `tools/match_binaries.py <starmaker.tsv> <main.tsv> --names tools/ghidra_names.csv [--out DIR] [--lookup ADDR ...]` does the matching (exact `h_norm`, then `h_mnem` for 1:1 cases of at least 12 instructions) and prints the counts of section 3; `--lookup` gives the StarMaker counterpart of main-binary addresses and `--out` writes `matches.json` / `unmatched.json`. The fingerprint tables and those outputs are not kept in the repo (they are large and regenerated by the two commands above, about 3 minutes in all, plus the StarMaker analysis). Run on 2026-11-24 it gave the numbers below.

## 3. How much is shared with MoviesSE **[read, measured]**

StarMaker has 11,000 functions (MoviesSE: 59,095 non-thunk).
* 5,567 have a unique exact match (same `h_norm`, unique on both sides); 4,858 more share their hash with other functions (mostly small CRT/STL/template code, so the match is ambiguous); 43 match on the mnemonic hash alone.
* **532 functions (183 KB of 1.59 MB of function code, 11.5%) have no match**; 186 of them are at least 200 bytes and 39 at least 1,000 bytes.
* **Unmatched does not mean editor-only**: the code also changed between the March and April builds. Example: the scene command dispatcher at StarMaker `0x492380` (strings `playsnd`, `set_fire_on` ...) is the same function as `SceneEventCommand_Dispatch` in MoviesSE, with differences.
* 1,372 of the unique matches are functions that already have a real name in the main project.

Functions we already reversed that StarMaker contains as a 1:1 match (StarMaker address <- MoviesSE address):

| StarMaker | MoviesSE | what |
|---|---|---|
| `0x43b9c0` | `0x9db5f0` | the head morph apply (`docs/CHARACTERS.md`, `tools/hd_dump.py`) |
| `0x4436e0` | `0xa1aad0` | the head builder (loads `generic_head.msh`, applies the `.hd` texture) |
| `0x426f60` / `0x427030` | `0x9d63a0` / `0x9d6470` | `CharacterModel_SetAgeMorph` / `SetWeightMorph` |
| `0x436bf0`, `0x437800`, `0x478aa0`, `0x4787f0`, `0x437200`, `0x437630` | `0x984ad0`, `0x9859c0`, `0xa4e030`, `0xa4db20`, `0x9852c0`, `0x9856f0` | `.anm` header, track set, channel, RLE decode, translation table, Euler to quaternion (`docs/ANM_FORMAT.md`) |
| `0x4208e0`, `0x420830` | `0x9ab4a0`, `0x9ab3f0` | pose sample to matrix, Euler to matrix |

No confident match for: the `.hd` loader (`0xa18e50`), `Anim_LoadByName` (`0x988d60`), `LH_LoadMeshBinary` (`0x9deb10`), `Scene_LoadFlm` / `Scene_ParseFlm`, the command dispatcher. These may differ between the builds, or the match was ambiguous (not checked which).

## 4. What it taught us so far

1. **Age and weight morph order (a correction) [read].** The editor's call of the morph function (`0x442eea`, in the function at `0x442cb0`) pushes the model's `+0x11c` (the age morph, written by `SetAgeMorph`) as the last float and `+0x120` (the weight morph) before the head mix (`+0x40`, zero when bit 0 of `+0x38` is set). So the second array of a `.hd` (B) is the **weight** morph and the third (C) the **age** morph. Our tools had them the other way round until commit `7c87d70`.
2. **`starmaker.ini` [data]**: 43 face sliders in groups `nose` (9), `eyes` (6), `mouth` (8), `jaw` (6), `cheek` (3), `ear` (3), `brow` (2), `eyebrow` (3), `head` (3), each as `[group] [name] [a][b]`, e.g. `[nose] [nose_length] [1][2]`. The first number goes up in steps of 3 from 1 to 127 (and 130 for `teeth_move_in_out`), so it indexes a vector of 3-float entries; the second number (0, 1 or 2) is not understood. **How a slider value turns into the face is not read yet.** **[guess]**: the slider vector is stored in the star file.
3. **`.fan` files [data]** (solved in section 8): `Data\Animations\Facials\<name>.fan` (64 files, 28 bytes: `u32 1, u32 0, u32 expression index, f32 1.0, u32 0, u32 9998 (or 99 for rage_open), u32 0`): e.g. `kiss` = 14, `blinkright` = 29, `rage_open` = 49. **[guess]**: the expression index (0 to 53) is the one `Actor_SetFacialExpression` takes for the `fclexp` scene command (`docs/FLM_FORMAT.md` 5f); where the 54 expression shapes themselves are stored is not known.
4. **`Data\Hairs\head_shape.dat` [data]**: `u32 876` then 876 triangles of `u16` indices, over 440 distinct vertices, all below index 755 (the 760-vertex face primitive of `generic_head.msh`). A face-region mesh; what the editor uses it for is not known.
5. **`Data\Costume\Datas\InfoTextures.fas` [data]** (20,292 bytes): a table of costume texture-layer names with small integers per entry. **Not used by the compositor** (section 11): the loader stores it in a global that nothing reads, in StarMaker and in MoviesSE. Probably authoring metadata.
6. **Star file [data]**: the strings `\The Movies\StarMaker\` and `\info.sm` (in the unmatched function `0x4277b0`), `STARMAKER THUMB`, and `*.cpak`. The `info.sm` layout is decoded in section 6.
7. **Other editor assets [data]**: `sm_generic.msh`, `mannequin_sm.anm`, `sm_pose.anm` (function `0x40e2fc`: the editor's own body and pose), `latex_%c_head_v00.msh` (head selection, `0x425e40`), `hair_gradiant.dds`, `hair_*.msh` with a `_nr.msh` variant (hair, `0x46d800`), `Data\Costume\Datas\%s`, `Thumbs\Heads\`, `Thumbs\Hair\`, the textures `SM\*.dds` (UI), makeup keys `SM_MUP_BEARD/COLOR/EYEBROW/MAKEUP/LIPSSTICK`.
8. **Star attributes [data]** (`SM_STAT_*`): Looks, Trimness, Bulk (chest or breast size), the five genres, Stress, Boredom, Appetite (food), Thirst (drink), Mood upper, Mood lower. They line up with `CStar` fields in a save (`Looks`, `WEIGHT`, the thresholds); the mapping is not checked.
9. **Older `.anm` loader [data]**: function `0x439a10` has the strings `Can't load anim %s` and `WRONG ANIM FILE FORMAT %s`: the editor's version of the animation loader, not matched to the main one; worth comparing for the `.anm` versions it accepts.

## 5. The StarMaker decompile and names

* `data/ExportDecompiledStarMaker/` (local only, about 9 MB, `index.csv` plus `decomp_NNNN.c`): 7,962 functions exported, 3,145 skipped as noise (thunks,
  `Catch@`/`Unwind@`), 1 failed (`0x47f2b0`, unreadable bytes). Command: `analyzeHeadless data/ghidra/StarMaker StarMaker -process StarMaker.exe -noanalysis -readOnly
  -scriptPath ghidra/scripts -postScript ExportDecompiled.java <abs out dir>`; run it after names are applied so the export carries them.
* `tools/starmaker_names.csv`: the 1:1 exact matches whose main-binary name is a real name (ambiguous and mnemonic-only matches left out), applied to the StarMaker
  project with `ApplyNames.java`. Regenerate it after new main-binary names with the two `FunctionHashes.java` runs and `match_binaries.py --out`.
* Not done: why the loader functions in section 3 do not match (changed code or ambiguous hashes); comparing the editor's older `.anm` loader (`0x439a10`) with the
  game's for the versions it accepts.

## 6. The star file (`info.sm`), from two saved stars and the editor's load code

A star is a folder `Documents\The Movies\Starmaker\<yyyy_mm_dd_hh_mm_ss>\` with `info.sm` (402 bytes), `star.hd` and `thumb.dds`. **[read, checked on saved stars made in the editor: an all-default star, a custom star with known settings, and stars that differ from the default in one thing each (one advanced slider, nine sliders at extremes, eye colour, hair colour, a female default)]**

The editor's load function `FUN_004043eb` (StarMaker `0x4043eb`; `param_1` is the struct read from `info.sm`) copies the fields into the UI. The sliders are objects of 0x114 bytes created in the UI constructor `FUN_00402ce3` (this+0x5c head blend, +0x60 skin blend, +0x64 age; found through the tooltip strings `SM_TOOLTIP_HEAD_BLEND_SLIDER`, `SM_TOOLTIP_TEXTURE_BLEND_SLIDER`, `SM_TOOLTIP_AGE_SLIDER` at `0x5cd73c`, `0x5cd718`, `0x5cd6f8`); a slider's value is the float at slider+0x108, 0 to 1. `ghidra/scripts/FindRefs.java` lists the references to an address.

| offset | type | meaning |
|---|---|---|
| 0x00 | u32 | 2 (version) |
| 0x04 | u32 | 402 (file size) |
| 0x08 | u32 | differs per save (an id or hash) **[guess]** |
| 0x0c | u32 | gender: 1 male, 0 female **[read, the female default star]** (its other changes: `head_f_white_jane.hd`, `hair_20s_f1.msh`; the attribute floats are the same as the male default star) |
| 0x10 | 14 x f32 | the star attributes, in the order of the `SM_STAT_*` rows: Looks (0x10), Trimness (0x14), Chest/Breast size, Action, Comedy, Horror, Romance, Sci-Fi, Stress, Boredom, Drink/Food, Mood upper, Mood lower. The custom star: Looks 0.3 (bar about a quarter full), Trimness 1.0 (bar full); the default star: Looks 0, Trimness 1.0. The row order of the last six is **[guess]** |
| 0x48 | char[32] | first head file (`head_m_white_joe.hd`) |
| 0x68 | char[32] | second head file, empty when none was picked |
| 0x88 | char[32] | hair mesh (`hair_20s_m5.msh`) |
| 0xa8 | f32 | head shape blend slider (0 = first head, default 0.5) **[read, matches the screenshot: 0]** |
| 0xac | f32 | skin tone blend slider (default 0.5; the custom star 1.0) **[read]** |
| 0xb0 | u32 | **eye colour index** (the 8 swatches, 0 first; the eye-colour star has 6). Goes to `FUN_00428280` (`this+0x6c`, applied to the head object `this+0x14`) **[read, checked by a save]** |
| 0xb4 | f32 | age slider; **age in years = slider x 47 + 18** (`FUN_00427130`), so 18 to 65. The custom star: 0.48 = 41 **[read]** |
| 0xb8 | u32 | **hair colour index** (the 6 swatches; the hair-colour star has 3). Goes to `FUN_00428200` (`this+0x70`) **[read, checked by a save]** |
| 0xbc, 0xc0, 0xc4, 0xc8, 0xcc | 5 x u32 | makeup choices, one list each, in the on-screen order Eyebrows, Eye Makeup, Color, Facial Hair, Lipstick. The slider position is `(index + 0.5) / list size` (the colour one uses `index - 1`). The custom star: 30, 7, 10, 4, 0 (eyebrows at the right end, makeup in the middle, colour 0.75, facial hair 0.2, lipstick 0) **[read]**; Baseline 1, 0, 1, 0, 0 |
| 0xd0 | 43 x f32 | the advanced face sliders (0.5 = neutral) in the order of `starmaker.ini`. The one-slider star has only `0xd0` (the first, `nose_length`) changed, to 1.0 **[read for the first slider; the rest of the order is a guess]** |
| 0x17c | u32 | 0 |
| 0x180 | UTF-16 | the star name, NUL terminated (the file ends there: 402 = 0x180 + 2 x (length + 1)) |

`star.hd` is a normal `.hd` file (0x94 + 3 x 996 x 24 = 71,860 bytes), the finished head. For the all-default star it is *not* a copy of `head_m_white_joe.hd`: the header words differ, and the vertex arrays differ by 1.4 mm (A), 8.5 mm (B) and 9.3 mm (C) on average with a few vertices 0.6 to 0.8 off, so something is applied even at default settings (the 0.5 sliders may not be neutral, or the age 18 or the head mix are baked in). Not explained yet. With head blend 0, the custom star's head is close to its first head as expected.

Saves "HairColor" and "EyeColor" differ from the default star's only in those two fields (and the file size, which follows the name length).

Not checked: how the 43 slider values and the makeup choices turn into geometry and textures (`FUN_00428500` applies the makeup choices; the slider code `0x4154a0` is still unread), and the hash at `0x08`.

Slider hover texts, read off the running editor: "Blend between head shapes", "Blend between skin tones", "Choose Eye Color", "Change Age" (left end reads 18); the head pickers open a grid titled "Give your Star a new head." (`SM_BROWSER_HEADS`). All of them are in `starmaker.lhts` under `SM_TOOLTIP_*`.

### Advanced slider effect on `star.hd` (the one-slider star against the default) **[read]**

`nose_length` at 1.0 (the neutral value is 0.5): the `star.hd` header words are identical to the default star's, only array A changes (136 vertices of the 996; B and C differ by float noise of 1e-6). The vertices move **only along z** (up), downwards, by at most 5.3 mm; the displacement is largest (3 to 5 mm) within 2 cm of a centre at about (0.178, -0.003, 1.698) in the head's own coordinates, falling smoothly to 0.1 mm at 6 cm, so a local falloff around a control point, not a per-vertex table. This fits the `starmaker.ini` entry `[nose_length] [1][2]`: the second number is the **axis** (0 x, 1 y, 2 z; nose width `[4][1]` is y, the head faces +x with z up), and the first number (1, 4, 7 ... in steps of 3) is a position in a vector of 3-float control points (43 sliders x 3 floats = 129, plus a leading entry; `teeth_move_in_out` is 130 **[guess]**). `FUN_00406354` parses the ini (`FUN_004062b1` makes a slider with the two numbers; the slider object keeps the second at +0x38); where the control-point vector is applied to the mesh (the falloff and the centres) is not read yet: look for the user of the sliders' values rather than their creator, probably in `0x4154a0` or `0x442cb0`.

Interesting corollary: the baked `star.hd` is the head with the sliders applied to A, so a reimplementation does not need the slider code to *load* a star, only to build one.

### The nine-slider star **[read]**

Nine advanced sliders at an extreme (value 0 or 1, neutral 0.5), the rest neutral, everything else as the default star: slider 0 `nose_length` 1.0, 1 `nose_width` 0, 25 `jaw_chin_width` 0, 29 `cheek_front_in` 0, 31 `cheek_side_in` 1, 36 `brow_height` 0, 39 `eyebrow_outer` 1, 41 `head_length` 1, 42 `head_height` 0 (index = position in `starmaker.ini`; the names are those of the ini and fit the face areas, but only slider 0 has been confirmed on its own). Header words differ from the default star's only in the file size. In `star.hd` 457 vertices move, by at most 22 mm; the 136 vertices of the `nose_length` save are all among them. Not a pure per-axis effect: `dx` (x is front/back) is up to 15 mm at the back of the skull (head length) but also a few mm on the face, where the x-axis slider cannot be the cause alone, so a slider moves its control point along its axis and the surrounding mesh follows (a smooth deformation) with some cross-axis components. The per-slider fields cannot be separated from one combined save: one more save per slider, or the code that applies them (`0x4154a0`, `0x442cb0`), is needed.

## 7. How the face sliders work: a face rig animation + linear blend skinning **[read in the code; checked against `mannequin_sm.anm`]**

Correction: `0x4154a0` (listed earlier as a candidate for the slider code) is called from `BuildAndDrawPrimitive` and the other render primitives, so it is renderer code, not slider code.

**The pattern.** The 43 advanced sliders are not a table of morph targets: they pose a small **facial skeleton**, and the head mesh is **skinned** to it.

1. `StarMaker_ApplyAllSliders` (`0x40edd9`) restores the head's vertex data from a pristine copy (`FUN_0043b8c0`: copies 8 dwords = 32 bytes per vertex of every primitive), then calls `FaceSlider_SkinHeadAtValue` (`0x40676b`) once per slider, in file order. Each call works on the result of the one before.
2. `FaceSlider_PoseAtValue` (`0x4066a1`): `frame = a x 100 - round(value x -199)`, i.e. `a x 100 + round(199 x value)` ticks (`AnimInstance_SetFrame`, `0xa03180` in the game, takes hundredths of a frame), so the animation frame is **`a + 1.99 x value`**, where `a` is the first number of the slider's `starmaker.ini` entry (1, 4, 7 ... 127 and 130; the ini is *not* sorted by `a`: its 23rd entry, `teeth_move_in_out`, has `a = 130` and the entries after it continue at 67, 70, ..., so the frame must be taken from the ini, not computed as `1 + 3 x index`). It then evaluates the pose into a table of 3x4 bone matrices at `0x7349b0` (`FUN_00436320`, 12 floats per bone: three rows of the matrix then the translation).
3. `FaceSlider_SkinHeadAtValue` then loops over all primitives and all vertices. A vertex has a skin record of **4 weights (floats) and 4 bone indices (bytes)**, 20 bytes (`FUN_0043ab80` gives a primitive's records), and the new position is `sum over the 4 influences of weight x (position x matrix_bone + translation_bone)`. Only the position is rewritten here (stride 0x20: position, normal, uv).
4. **The animation is `mannequin_sm.anm`** (134 frames, 108 channels; extracted with `tools/pak_extract.py`, read with `tools/anm_dump.py`): frame 0 is the base pose; a slider owns frames `a`, `a+1`, `a+2` = **minimum, neutral, maximum**. Checked: the neutral frame of every slider tried is identical to frame 0 in all 108 channels; only translations change (rotations stay put); about 15 channels move per slider, and they move along the slider's axis: `nose_length` (frames 1 to 3) moves the nose bones in z, by -7 to -12 mm from minimum to neutral (the one-slider star has the nose vertices 5 mm lower at value 1.0), `nose_width` (4 to 6) in y, `head_length` (124 to 126) in x (up to 4 cm on the skull bones), `head_height` (127 to 129) in z. Frames 130 to 132 belong to `teeth_move_in_out` (a = 130); frame 133 is spare. The AnimInstance interpolates linearly between the frames, so 0.5 is the neutral frame (`0.5 x 1.99 = 0.995`, about frame `a + 1`).
5. **`b`, the second number of the ini, is only the colour of the arrow in the slider's picture** (0 red = x, 1 green = y, 2 blue = z in the screenshots), not part of the mechanism.

**Relation to the main binary.** Every helper above is a 1:1 match of a MoviesSE function (the head mesh class, which is shared engine code): `FUN_0043b8c0` = `0x9db4f0` (restore vertices), `FUN_0043ab80` = `0x9d9d50` (skin record of a primitive), `FUN_0043c410` = `0x9dc040` (same-topology check), `FUN_0043b9c0` = `0x9db5f0` (the `.hd` morph apply), `FUN_00436320` = `0xa03c40` (evaluate the pose into the matrix table), `FUN_00428280` (eye colour) = `0x9d13b0`, `FUN_00427ff0` = `0x9d10d0` (refresh), `FUN_00442ba0` = `0xa19f90`, `FUN_00447e00` = `0x9a63a0`; `0x436320`'s caller `AnimInstance_SetFrame` and `MeshInstance_Constructor` are the game's own names. What does **not** exist in the game is only the editor side: the UI, the per-slider loop (`0x40676b`, `0x4066a1`) and the 4-weight skinning loop with its matrix table `0x7349b0`. So the game's head mesh class already holds per-vertex 4-weight bone data, which is the skinning data the game uses for facial animation too.

**Consequences.**
* Reimplementing the sliders needs: the per-vertex skin weights and bone indices of the head mesh (in `sm_generic.msh` for the editor, `generic_head.msh` for the game: the `f0 & 1` skin block that `docs/MSH_FORMAT.md` lists as unread), the bone matrices from `mannequin_sm.anm` at `frame = a + 1.99 x value` (translation only, linear interpolation), and the skinning formula above, applied slider after slider in ini order. Not yet checked numerically: the exact matrix convention (the neutral frame equals the base pose, so the matrices may be relative to it) and the mesh skin block layout. The saved `star.hd` (A array) is the result, so it is the test: the default star and the one-slider and nine-slider stars give the expected vertex positions for known slider values.
* **Facial expressions (`.fan`, `fclexp`) are probably the same mechanism [guess]**: the head has a face rig that an animation can drive, and a `.fan` file names an expression index (0 to 53) that would be a frame (or pose) of a facial animation applied by the same skinning; "where the 54 expression shapes are stored" (section 4, item 3) would then be an animation, not a shape table. Not checked: find which animation the game's `Actor_SetFacialExpression` samples.

### Result: the sliders are reproduced exactly **[checked]**

`tools/starmaker_sliders.py <sm_assets> <starmaker.ini> <star.hd of the all-default star> <test star.hd> <test info.sm>` skins `sm_generic.msh` (996 vertices, 108 face bones that are the 108 channels of `mannequin_sm.anm`; the skin block is the `f0 & 1` 20-byte-per-vertex block that `tools/msh_dump.py` already parses) with the bone pose at `frame = a + 1.99 x value`, one slider after the other, and compares with the real change in the saved `star.hd` (array A, positions only):
* **The one-slider star** (`nose_length` = 1.0): the same 136 vertices move, maximum 5.22 mm predicted against 5.26 mm saved, RMS error 0.02 mm on 1.22 mm of signal.
* **The nine-slider star** (9 sliders at extremes): the same 457 vertices move, total displacement 2.0649 predicted and saved, RMS error 0.03 mm on 4.2 mm of signal, maximum error 0.12 mm. A least-squares fit of the saved change on the 9 predicted fields gives a coefficient of 1.00 for each slider, so the effects add and nothing is missing.

Method used for a slider: skin matrix of bone *b* = `inverse(bind world of b) x current world of b` (row-vector convention; the current world matrix chains the animation's local rotation and translation up the bone tree, the bind pose is in the mesh's skeleton block), the new position is `sum of weight x (position x matrix)` over the four influences, and the *change* is the difference between the pose at `a + 1.99 x value` and the neutral pose at `a + 0.995` applied to the current positions (translation-only poses, so the order does not matter in practice). The first attempt used `1 + 3 x index` for `a` and failed for the entries after `teeth_move_in_out` (coefficients 0.14, -0.43, 0.0 for three of the nine sliders); with the ini's own `a` every slider fits.

So the advanced face sliders, the `info.sm` file and `star.hd` (the baked head) are all understood. Not yet checked: the normals and the other two arrays of the saved `star.hd` (B and C: the age and weight morphs; the default star's A differs from `head_m_white_joe.hd` by up to 0.8 cm, which could be the age-18 and weight baked in, or the head blend), whether the editor's head blend (`0xa8`) and the age slider also act through this rig, and `FUN_00436320`'s handling of rotations (no slider changes any rotation, so the sliders do not need it).

## 8. Facial expressions (`.fan`, `fclexp`): frames of a per-head face animation **[read in the code; checked on the data]**

**The chain.** The scene command `fclexp <name>` reaches `Actor_SetFacialExpression` (`0x980750`) and `FaceController_SetExpression` (`0xa304f0`), which accepts an expression index 0 to 52 (`param_1 < 0x35`: 53 values), stores it in the controller (`+0x184`) and later plays it as a blended animation: the update functions (`0xa30990`, `0xa30cb0`) fill a request (animation id, weight) and hand it to `FUN_009880c0`; the weight is `envelope x intensity x caller scale`, the envelope rising over 0 to 200 ticks and falling over 200 to 400 (the `200.0` / `0.005` constants).

**The animation is per head.** `FUN_00a30360` turns a head file name into an animation name: `head_m_white_joe.hd` becomes **`fe_m_white_joe.anm`** (strip `head_`, prefix `fe_`, `.hd` to `.anm`; `FUN_00a31110` loads it with `Anim_LoadByName` and expands it). Every head has its own `fe_<head>.anm` in `Data\Animations\High\` (about 40 in the paks, 12 KB each). The two checked (`fe_m_white_joe`, `fe_f_white_jane`) have **53 frames and 35 channels**: 53 = the 53 expression indices, 35 = the `fa_*` face bones of **`generic_facialskin.msh`**, the game's own version of the head mesh (the same 996 vertices, 65 bones: the 30 body bones plus those 35 face bones, 4-weight skin like `sm_generic.msh` of section 7). So a facial expression is **one frame of the head's face animation, applied to the face bones and skinned onto the head**, exactly the mechanism of the StarMaker sliders (section 7), with a different bone set and one animation per face.

**The `.fan` files** (64, in the paks) are the table of named expressions. Fields `[count, 0, frame, intensity, 0, flag word, 0]`: **word 2 is the frame in `fe_*.anm`** (all 53 values 0 to 52 occur), **word 3 is the intensity** (the float: `kiss` 1.0, `kiss_70` 0.7, `kiss_50` 0.5 are the same frame 14 at three strengths; `agony`/`agony50` frame 10, `shout`/`shout50` frame 34, `horror`/`horror75` frame 9; `neutral` is frame 0 at 0.42), word 0 is the number of entries (1 for 62 files, 2 for `eat`, 5 for one more), and word 5 (99 for 50 files, 9998 for 9, 998 for 2, a few others) is not understood (a priority or duration, **[guess]**).

**Checked on `fe_m_white_joe.anm`** (largest changes of a frame against frame 0): frame 29 (`blinkright`) moves only the right eyelid bones (`fa_eyelid_r_top` with a rotation, `fa_eyelid_r_bot`), frame 30 (`blinkleft`) only the left ones, frame 1 (`smile`) the mouth corners (`fa_mouth_l_corner`, `fa_mouth_r_corner`, the outer corners, the cheek), frame 3 (`sad`) the inner eyebrows and the mouth corners, frame 23 (`surprise`) the inner eyebrows and the Adam's apple, frame 14 (`kiss`) the inner eyebrows and the top lip, frame 49 (`rage_open`) the lower lip bones.

**What this gives.** `fclexp` is not a morph or a texture swap: to show an expression the game needs the head's `fe_<head>.anm` and `generic_facialskin.msh`, then `frame x intensity` (blended with the envelope above) skinned with the machinery of `tools/starmaker_sliders.py`. **Rendered** (`tools/render_expression.py`, a pure-Python rasterizer; `tools/render_expression_gif.py` makes an animated GIF in which each expression ramps in over 8 frames, holds for 4 and ramps out, following the controller's rise-and-fall envelope of 200 ticks each way (the exact tick length was not measured, so the GIF's speed is arbitrary); output in `docs/generated/expressions.png` / `.gif`, not tracked): `generic_facialskin.msh` skinned with frames 0, 1, 3, 23, 14, 49, 29, 34 of `fe_m_white_joe.anm` and textured with `head_m_white_joe.dds` gives a neutral face, a smile, a frown, a surprised small mouth with raised brows, a kiss pucker, a wide open mouth (rage_open), one eyelid closed (blinkright) and a shout, as the `.fan` names say. Method: the 35 animated bones are children of the body skeleton (mostly `head`), their animation values are local to the parent, current world = local x parent world (body bones at bind pose), skin matrix = inverse(bind world) x current world, positions are the weighted sum of the four influences. The mesh has three primitives: the face (760 vertices, `head_generic.dds`, replaced by the head's own texture), the **eyes** (58 vertices, material 2, `eyes.dds`) and the **mouth interior** (178 vertices: lips, teeth and tongue, `eyes.dds`); `eyes.dds` (256x256) is an atlas of the 8 iris colours (top two rows), four special eyes and the lips and teeth (bottom right). All three are skinned to the face bones, so eyes and teeth move with the expression. The renderer uses the mesh's own UVs (the default iris); picking one of the 8 irises by the `info.sm` eye colour index is not done, and a dark ring remains around each eye (the eyeball's surround in the atlas). Not yet done: a numeric check against a reference (none exists, unlike the saved `star.hd` for the sliders) and `intensity` handling beyond the linear blend toward the bind pose used by the renderer; how the controller chooses between the two heads of a blended star (`FUN_00a30fc0` takes two head names and a mix and `FUN_00a31110` loads both animations, so a blended face blends two expression animations); and the meaning of word 5.

## 9. Makeup, hair and iris colour; a whole star rendered **[read in the code; checked by rendering the saved stars]**

`tools/render_star.py <star folder> <assets> <out.png> [--expr FRAME[:INTENSITY]] [--yaw DEG]` (and `tools/render_star_sheet.py` for a contact sheet) builds a head from a saved star: `star.hd` array A (the baked shape) plus the age morph, the face textures with makeup and hair layers, the iris, and optionally a facial expression (section 8). Pure Python; it needs the assets extracted next to each other (`generic_facialskin.msh`, `eyes.dds`, `fe_<head>.anm`, the head textures, `mup_*.dds`, `hair_*.dds` / `.msh`; `data/game_data/sm_assets`). Results for the saved stars are in `docs/generated/stars.png` and `docs/generated/iris_hair.png` (not tracked).

* **Iris colour** (`info.sm` `0xb0`, 0 to 7): the eye primitive's UVs sit in the top-left 64x64 cell of the 256x256 `eyes.dds`; iris *k* is that cell moved by `(k mod 4, k div 4)` cells (0.25 of the atlas each). Rendered: brown, blue, black, hazel, grey-green, rust, blue-violet, green, in the order of the editor's swatches. The eye UVs include values of -0.002, so the atlas must be clamped, not wrapped (wrapping reads the black bottom of the atlas).
* **Hair colour** (`0xb8`, 0 to 5): a suffix on the hair texture name, from the table in the exe (`0x6122a0`: `_bd _bk _rd _db _px` after the unsuffixed base): 0 base (brown), 1 `_bd` (blond), 2 `_bk` (black), 3 `_rd` (red), 4 `_db` (dark brown), 5 `_px` (platinum). Checked by rendering all six on a male and a female: they match the editor's swatches in order. (`_gy` and `_sp` variants exist but are not in the table; `_gy` is the age overlay below.)
* **Hair style** (the name at `0x88`): `hair_20s_m5.msh` has **no geometry**, its look is a texture layer, `hair_20s_m5<suffix>.dds` (512x512, alpha) laid over the face texture; `hair_20s_f1.msh` is a real mesh (191 vertices, 4-weight skin to the body skeleton, the head at its bind pose so the vertices are used as stored) with the texture named in the mesh (`hair_20s_f1.dds` plus the suffix). The meshes' `.inf` files and the `a.dds` second stage (`hair_20s_m5a.dds`, set as texture stage 1 by `FUN_00441970`) are not used by the renderer (the `a` file is probably an alpha map); `_nr.msh` variants (`hair_*_nr.msh`) are not understood.
* **Age grey** (`FUN_00441970` hair, `FUN_004415a0` beard): when the age morph (`model+0x11c`, 0 below 30 years, +0.025 per year) is not zero, the `_gy.dds` variant of the hair or beard texture is blended over the coloured one at alpha = the age morph. The renderer does that; The custom star (age 41, morph 0.264) comes out grey like in the editor.
* **Face texture layers**: `FUN_0046dfd0(category, index)` names a layer file `mup_<kind>_v##.dds` with `##` = index - 1 in two digits, and index 0 means none; categories 0 and 1 `mup_eyes_v`, 2 `mup_lips_v`, 3 `mup_beard_v`, 4 `mup_tatoo_v`, 5 `mup_meyebrow_v`, 6 `mup_feyebrow_v`, 7 `mup_nails_v`, 8 `mup_mask_v` (`mup_mask` is full-face monster and costume paint, not star makeup). The layers are 512x512 DXT5 with alpha, in the same UVs as the face texture, composited over it. The five StarMaker makeup lists (`0xbc..0xcc`) are the character's makeup parameters (type 11 or 10 = eyebrows, 3 = eye makeup, 2 = colour, 5 = facial hair, 4 = lipstick, from the switch in `0x403ae8`); their option counts are consistent with the files: eyebrows 30 files + none = 31 (the custom star's 30 is the last), facial hair 21 beards + none = 22 (slider 0.2 at index 4), lipstick 20 lips + none, colour 13 `mup_eyes` files (index - 1 selects, slider at 0.73 for index 10 of 13). The beard layer follows the hair colour suffix (and the age grey).
* **Not understood / guessed**: how *Eye Makeup* and *Color* differ (both end up in `mup_eyes_v##`; the Eye Makeup list shows about 15 entries but only 13 files exist), the render uses file `index - 1` for each when the makeup is not 0, and ignores the colour when Eye Makeup is 0 (otherwise the default colour 1 draws a black outline); layer order (eyes, lips, eyebrows, beard, hair); the head blend slider `0xa8` (only the baked `star.hd` shape and the skin-tone blend `0xac` between the two head textures are used) and the weight morph; the second head's role beyond the texture blend; `Looks`/attributes do not affect the picture. The lighting is a flat ambient + one light, brighter than the editor's would be only in tone; the eyelid-interior triangles of the mouth primitive (black part of the atlas) are drawn slightly behind the eyeball, which is a choice of the renderer, not read from the game.

## 10. Answers read from the code (follow-up to section 9)

**Eye Makeup vs Color [read].** The character has a table of *parameters* (`this+0xcc`: count at `+0x28`, entries of 0x2c bytes, type at `+4`). `CharacterParam_TypeToMakeupCategory` (`0x4250b0`, main `0x9cd5e0`) maps a parameter type to a makeup *category*: type 2 -> 1, 3 -> 0 (both `mup_eyes_v`), 4 -> 2 (lips), 5 -> 3 (beard), 6 -> 8 (mask), 10 -> 5 (male eyebrows), 11 -> 6 (female eyebrows), 12 -> 7 (nails), 13 -> 4 (tattoo). So **Eye Makeup is type 3 = category 0 and Color is type 2 = category 1: two separate layers that both name `mup_eyes_v##.dds` files**, selected with `index - 1` (`MakeupLayer_GetFileName`, `0x46dfd0`). The option counts (`MakeupLayer_GetOptionCount`, `0x46e0f0` = highest file index found + 1 + 1 for "none") explain the two lists: 13 files give Eye Makeup 14 entries (0 = none) and Color 13 (the editor's slider uses `count - 1`, no "none"). The face compositor (`CharacterHead_ComposeFaceLayers`, `0x4415a0`, main `0xa17300`) walks the 9 layer slots (names at `this+0x128`, 0x20 bytes each) in order: slot 0 is only *remembered*, not drawn; slot 1 (the colour) is drawn **only if slot 0 has a name**, as a two-texture primitive (shape texture from slot 0, colour texture from slot 1; `Texture_DrawLayerPair`, `0x4473c0`, blend mode 0x25); slot 3 (beard) is drawn with the hair-colour suffix and then its `_gy` variant at alpha = age morph; slot 7 (nails) is skipped; the others are drawn as plain alpha layers (`Texture_DrawLayer`, `0x447290`, mode 6; a second mode 0x13/0x14 writes an alpha map, used for the hair `a.dds`). **Draw order is the slot order: eyes pair, lips, beard, tattoo, male and female eyebrows, (nails), mask.** The renderer now follows that; the exact two-texture blend of the eye pair (stage ops of mode 0x25) was not read, so it uses the shape file's alpha tinted with the colour file's average colour.

**Head blend and skin blend [read].** The Basics page update (`StarMaker_BasicsPage_Update`, `0x403c76`) calls `CharacterBlend_SetHeadMix` (`0x401da0`: clamp to 0..1, **forced to 0 unless a second head is chosen**, `CharacterBlend_HasSecondHead` `0x401d85`) and `CharacterBlend_SetSkinMix` (`0x4010f4`: clamp to 0..1, flags the texture dirty) on the blend block at `model+0x38`: `+0x38` flags (bit 0), `+0x3c` skin blend, `+0x40` head mix. `CharacterHead_Update` (`0x442cb0`, main `0xa1a0a0`) passes the two heads' `.hd` data and the head mix to `CharacterHead_ApplyHdMorph` (`0x43b9c0`), and the skin blend (`CharacterModel_GetSkinBlend`, `0x428570`) weights the two head textures. Bit 0 of the flags looks like "separate skin blend" (set in the editor: two sliders; in the game a character has one `HeadMix`, which would then serve both) **[guess]**. The saved `star.hd` is written *after* the head morph and the sliders, so **it already contains the head blend**; only the skin blend is applied again at render time (as `tools/render_star.py` does).

**Weight [read].** The editor's picture has no weight: its only calls are `SetWeightMorph(0)` and, while saving, `SetWeightMorph(100)`. `StarMaker_WriteStarHd` (`0x4070b1`) loads `generic_head.msh` three times and builds the head in three states, each followed by `StarMaker_RebuildHead`-style slider passes (`0x40edd9`): (weight 0, age 0) = array **A**, (weight 100 kg = 1.0, age 0) = array **B**, (weight 0, age 100 = 1.0) = array **C**, then `FUN_0043b3b0` exports the three meshes in `.hd` order. That confirms, from the writer, that **B is the weight morph and C the age morph**, and that a saved star carries *both full morphs on top of its slider shape*, so the game can apply the star's weight (from its Trimness) and age later. The age amount from the age slider is `years = slider x 47 + 18` (`0x427130`) then `CharacterModel_SetAgeMorph(years)`.

**The default star's offset [explained, one part open].** `star.hd` of an all-default star differs from `head_m_white_joe.hd` by 1.6 mm RMS. Skinning the `.hd` with all 43 sliders at 0.5 in `starmaker.ini` order, each pass *replacing* the vertices (as the editor does) reproduces the default star to 1.19 mm; most of the remaining 1.2 mm is a nearly constant shift (about -1.0, -2.4, -0.5 mm); with that removed the error is 0.18 mm. The frame `a + 0.995` of a neutral slider is not exactly the neutral frame, and 43 passes add up. The constant shift (probably a translation or bind-pose difference between `generic_head.msh` and the editor's rig) is not explained.

**`thumb.dds` [read].** `StarMaker_WriteThumb` (`0x407745`) renders the head into a 128x128 DXT1 target named `STARMAKER THUMB` (the code `0x31545844` is `DXT1`), copies its 0x2000 bytes over a template, `Data\Textures\BluePrint\thumb_hair.dds` (0x2080 bytes: a 0x80 byte DDS header plus the pixels), and writes the result: so `thumb.dds` is always 8,320 bytes (as in the saved stars).

**`info.sm` reader [read].** `StarMaker_ReadInfoSm` (`0x427180`) reads the file, checks that the first dword (the version) is 2, and sets the dword at `0x17c` (`_Memory[0x5f]`) to point at the name that follows at `0x180`: the zero at `0x17c` is a pointer slot filled in at load time. `StarMaker_SaveStar` (`0x408076`) is the save command: make the timestamped folder, `StarMaker_WriteThumb`, `StarMaker_BuildInfoSm` (`0x407d7f`), then `StarMaker_WriteStarHd`.

**Everything is shared with the game.** All of these helpers (compositor, hair texture, parameter table, makeup file names, hair and eye colour, blend getter, layer drawing) are 1:1 matches of main-binary functions, so the game builds a star's face with the same layers. New names (applied to the StarMaker project in `tools/starmaker_names.csv`, and written to `tools/ghidra_names.csv` for the 23 main-binary matches that were still `FUN_*`; the main Ghidra project was **not** changed, apply with `ApplyNames.java`):

| StarMaker | main | name |
|---|---|---|
| `0x4415a0` | `0xa17300` | `CharacterHead_ComposeFaceLayers` |
| `0x441970` | `0xa176d0` | `CharacterHead_ComposeHairTexture` |
| `0x441380` | `0xa17070` | `CharacterHead_CreateMesh` |
| `0x442cb0` | `0xa1a0a0` | `CharacterHead_Update` |
| `0x43b9c0` | `0x9db5f0` | `CharacterHead_ApplyHdMorph` |
| `0x43b8c0` | `0x9db4f0` | `Mesh_RestoreVerticesFrom` |
| `0x43ab80` | `0x9d9d50` | `Mesh_GetPrimitiveSkinRecords` |
| `0x43c410` | `0x9dc040` | `Mesh_HasSameTopology` |
| `0x436320` | `0xa03c40` | `AnimInstance_EvaluatePose` |
| `0x46dfd0` / `0x46e100` / `0x46e0f0` | `0xa5ee00` / `0xa5ef30` / `0xa5ef20` | `MakeupLayer_GetFileName` / `_GetIndexFromFileName` / `_GetOptionCount` |
| `0x4250b0` | `0x9cd5e0` | `CharacterParam_TypeToMakeupCategory` |
| `0x425440` | `0x9cdc00` | `CharacterModel_GetParamOptionCount` |
| `0x4258c0` | `0x9ce200` | `CharacterParam_SetOption` |
| `0x426740` / `0x4266d0` | `0x9cf8f0` / `0x9cf880` | `CharacterModel_SetParamByIndex` / `_SetParamClamped` |
| `0x428200` / `0x428280` | `0x9d1330` / `0x9d13b0` | `CharacterModel_SetHairColour` / `_SetEyeColour` |
| `0x428500` | `0x9d1740` | `CharacterModel_SetMakeupParam` |
| `0x428570` | `0x9d1cb0` | `CharacterModel_GetSkinBlend` |
| `0x447290` / `0x4473c0` | `0x9a57d0` / `0x9a5900` | `Texture_DrawLayer` / `Texture_DrawLayerPair` |
| `0x401da0` / `0x4010f4` / `0x401d85` | (too small to match) | `CharacterBlend_SetHeadMix` / `_SetSkinMix` / `_HasSecondHead` |
| `0x4070b1`, `0x408076`, `0x407745`, `0x427180`, `0x42cfb0`, `0x40efd9`, `0x403c76`, `0x40621b` | editor only | `StarMaker_WriteStarHd`, `_SaveStar`, `_WriteThumb`, `_ReadInfoSm`, `_GetDocumentsPath`, `_RebuildHead`, `_BasicsPage_Update`, `_FindOrCreateSliderGroup` |

Still open: the two-texture blend mode 0x25 of the eye pair; what `FUN_0043b3b0` does exactly (it is called three times by the `star.hd` writer and reorders vertices into `.hd` order); the constant ~1 mm offset of the baked head; the meaning of bit 0 of the blend flags; the `a.dds` alpha maps and `_nr.msh` hair variants.

## 11. Body and costume textures (research; nothing built yet)

**[read in the decompile; the layer-to-atlas mapping checked by rendering one costume]**

**The costume texture is composited from layers, the same way as the face.** The body mesh (`cos_m_50s_1.msh`) has one 512x512 diffuse atlas (`cos_m_50s_1.dds`). The costume layers (`com_*.dds`, 512x512 DXT5 with alpha) share its UVs: for `m_50s_1.cos`, the jeans, shirt, belt and shoe layers each land on their own region of the atlas, and the atlas itself shows the default costume baked on top of skin.

**`InfoTextures.fas` is not part of this.** 390 rows after a 12-byte header (u32 0, u32 count, u32 runtime pointer), 52 bytes each: name[32], then five u32. The first is a decade (1900 to 1990, 0 for two rows); the next three are small codes (0 to 11, 0 to 9, 0 to 8) not decoded; the fifth is always 0. `FindRefs.java` on the global (`0x74f5e0` in StarMaker, `0x10c9ad0` in MoviesSE) finds only the loader and the free. The old guess in section 4 was wrong.

**The compositor is `FUN_004707e0`** (StarMaker; `this` is the costume, `param_1` the character model; MoviesSE has the equivalent, not located). In the editor the mesh's `cos_*` texture slot is replaced by a render target named `costume` (`FUN_00425e40`, the `.cos` loader, does it; the head and hair slots get the same treatment). Draw order:

1. The base skin, then three alpha-weighted skin overlays (`skin_<g>_<race>_<n>.dds`, `_enh`, `_old`; the pak has all three for each skin). Names come from `FUN_00428410` / `FUN_00428570`, alphas from `FUN_00427ec0` of the age morph (`model+0x11c`) and the weight morph, clamped to 0 to 255. **Which overlay uses which morph, and the formula, are not read.**
2. `skin_blend_body_%d.dds` (the skin blend slider), then `FUN_004705c0`: a body layer named at `model+0x208`, `mup_bodytatoo_v<N>` (name at `+0x1a8`, 17 characters, drawn when the list entry for N is non-zero), and a third layer from `+0x228` with `body` appended (not identified).
3. If the costume has a latex head mesh (mesh record type 4): `mup_latex_v%02d.dds`, with `_t%d` added when the record's `+0x28` is above 0.
4. Each texture record of the `.cos`, in file order, through `Texture_DrawLayer` (`0x447290`). The record's type (`+0x20`) selects the mode: 0 is a normal colour draw (mode 6); anything else is drawn as an **alpha map** (mode 0x13, writes the alpha channel only, for transparency such as the `..._a.dds` layers). If no alpha map was drawn, the alpha channel is filled opaque (`Texture_DrawLayer(0, 1)` = mode 0x14, colour `0xff000000`).
5. The layer's variant number is spliced into the name by `FUN_0042c570` (`com_..._v00.dds` becomes `_v%02d` with the current variant); `FUN_0042c480` returns the variant count and the default. **Not read.**

**`.cos` record layout** (from `FUN_004251d0` for textures and `FUN_004252d0` for meshes; `tools/cos_dump.py` already finds the strings). Texture record, 0x54 bytes in the file, then optionally 0x24 more bytes when flag bit 3 is set (`FUN_00425130` copies them as nine words):

| offset | meaning |
|---|---|
| 0x00 | file name, 32 bytes |
| 0x20 | type: 0 colour layer, other values alpha map |
| 0x24 | a float (0.04, 0.09 ...), not read |
| 0x28 / 0x2c | variant count / current variant (replaced by `FUN_0042c480` at load; if flag bit 0 is set the current is copied from the count) |
| 0x30 | slot name, 32 bytes (`cos_shoes`, `cos_color_2`, `cos_dress` ...) |
| 0x50 | flags (file version 6 and up; before that 0): bit 0 variant locked, bit 3 extra block follows; the loader adds bit 1 when the name does not start with `com_` |

Mesh records start the same way (name, a type byte at `+0x20` with 5 set for `acc_glasses_*`, a flags byte at `+0x21`: bits 0 and 4 force the variant to 1, bit 1 adds a 4-byte field, bit 2 the 0x24-byte block). The `.cos` header (0xa8 bytes) holds the counts as bit fields in one word: texture records `(w >> 2) & 0x1f`, mesh records `(w >> 7) & 0x1f`; a year range sits at 0x8c to 0x90 (1977 to 1993 for the cheerleader; meaning a guess). A trailing array of 0x40-byte entries is the editor's parameter list (`this+0xcc`). The parameter types are the ones in section 9 (0 = a texture record's variant, 1 = a mesh variant, 2 to 6 and 10 to 13 = makeup categories, 7 to 9 = other lists, via `FUN_00425440`).

**A saved `CCostume` stores the choice as that parameter list.** In the Wine save the blob (1,047 bytes) holds the costume name, the `.cos` name, the table of 0x2c-byte parameter entries (the first byte of each looks like the index, then the type, then the value) and, at the end, the makeup names and the hair mesh. No `com_*` names are stored, so the variant of each layer must be decoded from the table. Not decoded.

**Considerations for building it**
* Reuse: DDS decoding, `Texture_DrawLayer` and the face layer order are done. A costume compositor is the same code with different inputs.
* Prototype in Python first (`tools/render_costume.py`, shaped like `render_star.py`), check against an editor screenshot, then port to `web/src/sim/character/`.
* Open before it can be exact: the skin overlay alphas, the variant naming (`FUN_0042c480`, `FUN_0042c570`), the saved parameter table, the float at record `+0x24`, the third body layer at `model+0x228`.
* Accessories (hat, glasses, watch, ring) are separate meshes attached at the slot named in the mesh record; no compositing.
* Not touched: tattoo and nail layers on the face side, the 532 StarMaker-only functions, the editor UI.
