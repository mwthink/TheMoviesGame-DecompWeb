# Lighting experiments

The original game has no dynamic light: surfaces are lit by baked lightmaps (`lm_*` textures on a second UV set, doubled by 255/127, `WEB.md`), the ground and most props are
unlit, and people are drawn by their texture. The web app keeps that as the default. The dev menu's **Sun** section (collapsible, like every dev-menu section) is a first
experiment with a movable sun: no shadows yet.

## What it does (`web/src/world/Sun.ts`, `SunLight.ts`, the shaders in `shaders.ts`)

With **Sun lighting** on, every sun-aware surface (the terrain and the static models: buildings and props) is drawn as

    colour = diffuse * (baked * lightmap + ambient + strength * max(0, normal . toSun))

where `lightmap` is the baked one (1 where a surface has none) and the sliders are: **Direction** (compass, 0 = north, 90 = east), **Height** (degrees above the horizon),
**Sun strength**, **Ambient** and **Baked light** (1 = the lightmap as the game had it; lower lets the live sun dominate). With the sun off the shaders take the game's original path
unchanged. People switch from unlit to Babylon lighting (a directional sun and a hemispheric ambient). The terrain is flat, so its normal is straight up.

## Known limits

- The baked lightmaps already contain the sun's direction and shadows, so with the sun on there are two sets of shading; lowering **Baked light** hides the baked one.
- No shadows (casters, receivers and cascades are the next stage), the flag cloth and room floors are not sun-lit, and alpha-cut leaves have flat normals as the models give them.
- The shading is a guess at a pleasant model, not the game's.
