# Characters from a saved game

`tools/export_person.py "<game>/Data/pak" --save "<save>.jad" --list` lists the people of a save that have a costume; `--person <id>` builds `viewer/data/character.json`, shown by `viewer/index.html`
(see `docs/ANM_FORMAT.md` for the viewer, skeleton, skinning and animation). `--cos <name>` builds a costume without a save.

## What a save stores about a person (`tools/save_cast.py`)
* `CStar` and `CWannabe`: `Head[0]` = a length-prefixed head file name (`head_f_japanese_girl.hd`); `Head[1]` and `HeadMix` blend a second head in (not used yet); `PCurrentCostume` and `PNormalCostume` = object ids of `CCostume` objects.
* `CCostume`: no tagged variables; the object body is a blob with the costume name (`f_cheerleader_1`), the `.cos` file name, the makeup textures (`mup_eyes_v00.dds`, `mup_feyebrow_v00.dds`) and the hair mesh (`hair_20s_f12.msh`), found by scanning for strings (the layout is not decoded).
* In `quick film studios22 January 19600114Tuesday24November2026.jad` 49 people are saved (33 `CStar`, 16 `CWannabe`); 7 have a head, 10 a costume blob. The others have neither (the game probably builds them when they are first needed; not checked).

## `.cos` costumes (`tools/cos_dump.py`)
Records of 0x78 bytes after a 0xa8 header: the body mesh name, then texture layers (`com_m_50s_shoes_1_v00.dds`, slot `cos_shoes`) and attached meshes (hat, glasses, watch, ring: `hat_m_gen_v04.msh`, slot `cos_hat`), told apart by a kind field (1 = texture, 2 = mesh).
Parses all 464 `.cos` files; 406 (format byte 3) have the record layout, 58 have other formats and give only the body mesh name. The floats/flags in each record are not decoded.

## `.hd` heads
The first string (at 0x0c) is the head's texture (`head_m_white_man2.dds`); the rest (about 71 KB) looks like a shape morph for `generic_head.msh` and is not decoded. Heads of every sex use `generic_head.msh` here, so the face shape is the generic one with the person's skin texture.

## Result
The first person of that save (`CStar 1245`, `f_cheerleader_1`, `head_f_japanese_girl.hd`, `hair_20s_f12.msh`) renders in the viewer with the female skeleton, her costume atlas, hair, head texture and the walk clips; the other nine people with costumes export without errors (not looked at one by one).
Not done: the head morph, makeup, hair and skin tint, accessories (the meshes named in the `.cos`), the costume's separate texture layers (the body mesh's own atlas is used), and placing the person at their saved position.
