# Character viewer

The web app's **Character Viewer** (main menu) is the port of the standalone three.js viewer (`viewer/index.html`, `ANM_FORMAT.md`) onto the app's own pipeline, so it
shows exactly what the world view draws. Code: `web/src/screens/CharacterViewerScreen.ts`; the model comes from `PersonModelBuilder` (`web/src/world/WorldData.ts`),
the meshes from `PersonMeshes` (`web/src/world/PersonMeshes.ts`, also used for the people in the world), posing from `web/src/sim/anim/AutoAnimation.ts`.

## What it does

- **Who:** pick any costume (`data\costume\datas\*.cos`, 400+), head (`data\heads\*.hd`, or the default for the costume's sex), hair mesh (`hair_*.msh`) and set age and weight
  (the head morph, `CHARACTERS.md`). **Saved game** (a file picker; read in the browser, nothing uploaded) lists the people of a save; choosing one fills the controls from it.
- **Costume looks:** under the costume choice, a select per variable texture layer (`cos_shoes`, `cos_tshirt`, `cos_dress`...) lists the variants that exist (`com_..._v00.dds`, `_v01`, ...;
  `STARMAKER.md` section 11) and a select per accessory (hat, glasses, watch, ring) lists `(none)` and its variants. Choosing a layer variant paints the variants of all the costume's
  layers over the body atlas in `.cos` order with plain alpha blending (`CostumeLayers.ts`); accessories are separate meshes, drawn with an alpha cut-off, and a static one (a hat)
  follows the head bone, the others are skinned like the body. Accessories start off. [guess] The atlas stands in for skin and the overlays under the layers; the alpha-map records
  (`..._a.dds`) are not applied. A saved person's variants are not decoded (`STARMAKER.md` section 11), so choosing one resets the layers to the costume's own.
- **Character string:** *Copy character to clipboard* writes the look (costume, head, hair, age, weight, layer and accessory variants) as one line, `OTMCHAR1:` and base64 of a JSON array
  (`CharacterCode.ts`); *Copy character from clipboard* reads one back and fills the controls. The loading-screen editor (`LOADING_SCREENS.md`) has the same two buttons in its
  3D character section; a pasted character there is drawn with its head, hair, age, weight and variants. Names in a pasted string are checked (plain file names only).
- **Animation:** any of the ~8,000 clips in `data\animations\high\` that fit the 30-bone skeleton (a filter box narrows the list; a clip with another bone count says so).
  Play, speed, a scrub bar, the clip's frame count and length (`AUTO_ANIMATION.md`).
- **Look:** textures on/off, wireframe, back faces.
- **Camera:** orbit with the mouse, wheel to zoom (Babylon `ArcRotateCamera`). Escape or Back returns.
- Needs the game archives: from Load Game's chosen folder, the dev server's local files, or a remembered folder (the same lookup as the front-end logo, `findGameArchives`).

## Differences from the old viewer

- No skeleton overlay yet, and no hemisphere/sun lighting: people are drawn unlit by their texture (as in the world view).
- Posing is done on the CPU (`skinTransforms` + `skinVertices`, quaternion-free: Euler angles blended between frames) instead of three.js skinned meshes, so the app needs no
  exported `character.json`; `tools/export_person.py` and `tools/export_character.py` are no longer needed to look at a character and the old viewer is kept only for its tools.
- Not done: makeup layers, hair colour tint, alpha maps, the skin overlays and the saved variants of a person's costume (`PEOPLE.md`), and the StarMaker editor's face sliders (`STARMAKER.md`; the slider and
  expression maths is ported in `web/src/sim/character/FaceRig.ts` but has no screen). Those are the next step for the editor.
