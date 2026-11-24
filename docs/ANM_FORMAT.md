# `.anm` animations, skeletons and skinning

`tools/anm_dump.py <file.anm>` decodes a clip; `tools/export_character.py` turns a costume + clips into `viewer/data/character.json`, shown by `viewer/index.html` (three.js, vendored in `viewer/vendor/`; start with the `character-viewer` entry of `.claude/launch.json`, or `python3 -m http.server --directory viewer`).
Layout read from `Anim_ReadHeader` (`00984ad0`), `Anim_ReadSetHeader` (`00984b40`), `Anim_ReadTrackSet` (`009859c0`), `Anim_ReadChannel` (`00a4e030`), `Anim_DecodeRleArray` (`00a4db20`), `Anim_BuildTranslationTable` (`009852c0`), `Matrix_FromPackedPoseSample` (`009ab4a0`), `FUN_009ab3f0` (Euler to matrix).

## Checked against real files
`walk.anm`, `walk_angry`, `walk_zombie`, `walk_casual_stroll`: the parser ends exactly at the end of each file. 30 channels = the 30 bones of `cos_m_50s_1.msh` (the parent table in the anim equals the skeleton's parents); the anim's translations equal the bind-pose local offsets (0.046, 0.121, 0.431 ...). Played on the skinned costume the walk looks right (legs alternate, arms counter-swing).
Not checked: other costumes/skeletons (female, creatures), clips with a different channel count, the meaning of the file header's 12 floats (for `walk.anm` identity + (0.276, 0, 0), looks like the root movement of one cycle), the set header's other floats (the first is the clip duration in seconds: 1.674 s for `walk.anm`), version < 12.

## `.anm` (version 12, usually `zcmp`-wrapped like `.msh`)
```
file header 0x3c bytes: u32 version, 4 bytes, 12 x f32 (3x3 matrix + translation), 4 bytes
set header  0x1c bytes: u32 n_frames, u16 n_channels, u8, u8 flags, f32 duration(s), 3 x f32, f32 (flags & 2)
f32 translation scale (flags & 1; default 10.0), n_channels bytes parent bone index (0xff = root), pad to 4
n_channels channels: u8 flags (bit 0 = translation constant), 3 bytes, 3 RLE arrays (rotation x, y, z) pad4, then 3 RLE arrays (translation) or 3 f32 constants, pad4
RLE array: u16 mask M, then u16 words until n_frames values: (w & M) == 0 is one literal value; otherwise a run of count
           (((w - M) >> 1) & 0xffff & (~(M-1) >> 1) & 0xffff) | ((M-1) & w), value = the next u16
values: u16. rotation angle = ((v - 0.5) / 32768 - 1) * pi, translation = (v / 32767 - 1) * scale
```
The three angles are Euler angles; matrix rows (row-vector convention, rows = the bone's axes in its parent's frame):
`[cy cz, cy sz, -sy], [sx sy cz - cx sz, cx cz + sx sy sz, sx cy], [sx sz + sy cx cz, sy cx sz - sx cz, cx cy]`. Translation is in the parent's frame. The last frame equals the first (loop with n_frames - 1 steps).

## Skeleton and skinning in `.msh`
After the nodes (`rest` in `msh_dump.parse`): u32 ?, u32 n_bones, then n_bones x 84 bytes: 32-byte name, i32 parent, 12 x f32 = the **world** bind pose (3 rows = the bone's axes in model space, then translation). Z is up. Costumes, heads and hair share the same 30 bones (root, lowgut, gut, chest, neck, arms, hands, fingers, thumbs, legs, shins, feet, toes, head).
Skinning is the `f0 & 1` block (20 bytes per vertex): 4 x f32 weights (sum to 1) then 4 bone indices (u8, index into the bone list). Checked on 2053 vertices of `cos_m_50s_1.msh`.

## Textures: same-named files in the paks
Several textures exist twice or more under one name in different directories of the paks: `hair_50s_m1.dds` is a 512x512 DXT3 texture (349680 bytes, the real one) and a 128x128 UI icon (8320 bytes, in two archives); `eyes.dds` is a 256x128 DXT3 iris sheet and a 256x256 DXT1 sheet (irises, teeth strip: the one `generic_head.msh` uses, 43832 bytes); `head_m_white_joe.dds` is 512x512 (174904 bytes) and a 128x256 variant. `pak_extract.py` keys files by (name, order within the archive) and lets later archives override by that key, so it can keep the small icon and drop the real texture. For the viewer the right variants were picked by size from a one-off dump (`data/game_data/chars/variants/`). The fix for `pak_extract.py` is to resolve the directory of an entry (the header has a directory table).

## Open
How the `.cos` costume file (body mesh, textures, hat, glasses ...) picks its parts is not decoded; the head and hair in the viewer were picked by hand (`generic_head.msh`, `hair_50s_m1.msh`). Skin and hair tinting at runtime (the `skin_*`, `hair_*_bk/_rd/...` variants) is not looked at. The viewer does not apply root motion.
