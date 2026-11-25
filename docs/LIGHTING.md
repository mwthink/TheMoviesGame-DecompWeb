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

## Shadows (dev menu, "Shadows")

With **Sun lighting** on, **Sun shadows** adds a shadow map (`web/src/world/SunShadows.ts`, the frustum maths in `Sun.ts`):

- **One orthographic map around the whole lot** (4096 texels, or 2048 with "Smaller map"), seen along the sun; it is redrawn every other frame because people and flags move. The lot
  is about 400 x 400 units, so a texel is about a tenth of a unit and a person's shadow is a few texels wide. Cascades (a close-up map near the camera) are the next step if that is
  too soft.
- **Casters:** every placed model instance and every part of every person. Each caster's material gets a depth twin (`otmDepth`) with the same diffuse texture, so leaves and hair are
  alpha-tested and a cutaway model drops its roof. The depth is packed into the four bytes of an ordinary RGBA texture (no float texture needed).
- **Receivers:** the terrain and the static models (`shadowFactor` in `shaders.ts`: a 3 x 3 filtered compare). **People do not receive shadows yet** (they are lit by Babylon lights, not our shaders).
- **How it shades:** `colour = diffuse * ((baked * lightmap + ambient) * (1 - darkness * (1 - shadow)) + strength * normal.sun * shadow)`: a shadowed surface loses the sun's
  part and a share (`Darkness`) of the ambient and baked light, so shadows show even with the baked lightmaps on. **Bias (units)** stops surfaces shadowing themselves.
- **Checked:** the render path was tested end to end in a browser with a ground quad and a slab: the shadow fell where the sun direction says and nothing else changed; the full lot has
  not been timed.

### Known limits

- The baked shadows in the lightmaps are still there, so a building has its baked shadow and the live one; lower **Baked light** to see only the live one.
- Slanted surfaces can show acne or peter-panning at the wrong bias; one bias for the whole lot is a compromise.
- Cost: the lot is drawn a second time from the sun every other frame. If that is too slow, use the smaller map, or limit casters to people and buildings.
