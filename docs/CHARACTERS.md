# Characters from a saved game

`tools/export_person.py "<game>/Data/pak" --save "<save>.jad" --list` lists the people of a save that have a costume; `--person <id>` builds one character and `--all` every person with a costume, each into `viewer/data/<id>/` (and `viewer/data/index.json`, the list the viewer's selector shows; the archives are indexed once per run, about 10 s, then each person takes about a second). `viewer/index.html` shows them
(see `docs/ANM_FORMAT.md` for the viewer, skeleton, skinning and animation). `--cos <name>` builds a costume without a save.

## What a save stores about a person (`tools/save_cast.py`)
* `CStar` and `CWannabe`: `Head[0]` = a length-prefixed head file name (`head_f_japanese_girl.hd`); `Head[1]` and `HeadMix` blend a second head in (not used yet); `PCurrentCostume` and `PNormalCostume` = object ids of `CCostume` objects.
* `CCostume`: no tagged variables; the object body is a blob with the costume name (`f_cheerleader_1`), the `.cos` file name, the makeup textures (`mup_eyes_v00.dds`, `mup_feyebrow_v00.dds`) and the hair mesh (`hair_20s_f12.msh`), found by scanning for strings (the layout is not decoded).
* In `quick film studios22 January 19600114Tuesday24November2026.jad` 49 people are saved (33 `CStar`, 16 `CWannabe`); 7 have a head, 10 a costume blob. The others have neither (the game probably builds them when they are first needed; not checked).

## `.cos` costumes (`tools/cos_dump.py`)
Records of 0x78 bytes after a 0xa8 header: the body mesh name, then texture layers (`com_m_50s_shoes_1_v00.dds`, slot `cos_shoes`) and attached meshes (hat, glasses, watch, ring: `hat_m_gen_v04.msh`, slot `cos_hat`), told apart by a kind field (1 = texture, 2 = mesh).
Parses all 464 `.cos` files; 406 (format byte 3) have the record layout, 58 have other formats and give only the body mesh name. The floats/flags in each record are not decoded.

## `.hd` heads and the face morph (`tools/hd_dump.py`)
Read from `Head_Load` (loads `Data\\Heads\\<name>`), `Head_FindOrCreate` (builds a head from `generic_head.msh`) and `FUN_009db5f0` (the morph):
* `0x0c`: the head's texture name (`head_f_japanese_girl.dds`); from `0x94` on, **three arrays of 996 vertices x 6 floats** (x, y, z, nx, ny, nz). 996 = 760 + 58 + 178 = the vertices of `generic_head.msh` in file order (the 760-vertex face, the 58-vertex eyeballs, the 178-vertex eyelid/mouth shell). Array A is the head's own shape (within 2.4 cm of the generic head, 6 mm on average, identical on the eyeballs), B and C are deltas.
* vertex = A + weight * B + age * C for one head; with two heads (`Head[0]`, `Head[1]`, `HeadMix`): (1 - mix) * (A0 + weight B0 + age C0) + mix * (A1 + weight B1 + age C1); normals the same, then normalised.
* The two amounts are the weight morph (`CharacterModel_SetWeightMorph`: 0 at 60 kg, +0.025 per kg, 1.0 at 100 kg; model field +0x120) and the age morph (`SetAgeMorph`: 0 below 30 years, +0.025 per year, 1.0 at 70; field +0x11c). **B is weight and C is age**: read from the disassembly of the call in `StarMaker.exe` (0x442ea6-0x442eea, the decompiler drops the float arguments), where the editor pushes +0x11c as the last float and +0x120 before the head mix (+0x40, zero when bit 0 of +0x38 is set). An earlier version of these notes and tools had them the other way round (an assumption). The deltas are 1 to 4 cm at most.
* All 166 `.hd` files in the game parse (size 0x94 + 996 x 72 bytes). A person with no stored head gets `head_f_white_jane.hd` / `head_m_white_joe.hd` (the defaults named in the loader).
* Age and weight of a person come from the save: `WEIGHT` (kg) and `Birth` (a day number, 365 days a year); the current day is taken from the `PreviousAwardsDate.YearInDays` static (1 January of the current year), so ages are up to a year too high. The saved people are 19 to 25 years old and one 60, 60 to 84 kg.

**A deviation from the data.** Applied exactly as read, the morph moves the face and the eyelid shell by up to 5 mm while the eyeballs stay (their A equals the generic head), which buries the 2-3 mm proud eyeballs and shows as dark eyes. How the game avoids this was not found; `export_person.py` fades the morph out within 6 mm of an eyeball vertex (full effect from 2.6 cm) for the face and the eyelid shell. Checked in the viewer on a 60-year-old head: eyes look right and the cheeks and jaw differ from the unmorphed head.

## Result
The first person of that save (`CStar 1245`, `f_cheerleader_1`, `head_f_japanese_girl.hd`, `hair_20s_f12.msh`) renders in the viewer with the female skeleton, her costume atlas, hair, head texture and the walk clips; the other nine people with costumes export without errors (not looked at one by one; the morph was looked at on one head only).
Not done: makeup, hair and skin tint, accessories (the meshes named in the `.cos`), the costume's separate texture layers (the body mesh's own atlas is used; `Data\Costume\Datas\InfoTextures.fas` is the lead for how they are combined), the face sliders and facial expressions (`starmaker.ini`, the `.fan` files), and placing the person at their saved position. `StarMaker.exe`, the character editor, contains the same head and `.anm` code and the slider UI: see `docs/STARMAKER.md`. The face morph is applied with the deviation above; what the game does around the eyes is open.
