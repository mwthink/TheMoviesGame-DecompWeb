# Dev tools

The dev menu (bottom right in the game view; every section folds away) holds the tools for looking inside the world. All of them are off or neutral by default. Code:
`web/src/ui/DevMenu.ts` (the controls), `web/src/world/DevViews.ts`, `SunLight.ts` and the shaders (the views), `GameView.ts` (the wiring).

| Section | What it does |
|---|---|
| **Performance** | frames per second, the average frame, render, mesh-selection and render-target times, the CPU time of the shadow pass, draw calls, active meshes, triangles drawn and materials (Babylon's `SceneInstrumentation`) |
| **Views** | **World shading**: Normal, Diffuse only, Lightmap only, Normals, Sun term (normal . sun), Shadow factor: a `debugMode` uniform in the terrain and static-model shaders (the people use Babylon materials and are not affected). **Show the shadow frustum**: the sun's shadow box as a wireframe. **Shadow map viewer**: the depth map as a 192-pixel grey picture (white = far or empty), read back twice a second from a small copy, never from the 4096 map. **Outline what the pointer is over**: a yellow outline round a person and a blue one round a building (`HoverHighlight`) |
| **Time control** | a scale on the game speed from 0.1x to 10x (it multiplies the clock and the people's animation, not the flags) and **Step one tick** (0.1 s of game time, also moves the people on), for watching motion while paused |
| **Sky** | the sky's variant: the game's year rule (the default) or one of its three eras (`SKY.md`) |
| **Sun**, **Shadows**, **Rooms**, **Camera** | `LIGHTING.md`, `ROOM_DISPLAY.md`, `CAMERA.md` |

## Notes

- Babylon's `HighlightLayer` does not accept instanced meshes (it needs `onBeforeBindObservable`), and the world's buildings are instances; the outline is made through temporary clones of the building's showing instances (shared geometry and material), removed when the pointer leaves.
- The shadow map viewer draws the map through Babylon's `EffectRenderer` into a small render target, unpacking the packed depth in a fragment shader.
- Shader source comments must not contain quotes or semicolons (`tests/shaders.test.ts`).
