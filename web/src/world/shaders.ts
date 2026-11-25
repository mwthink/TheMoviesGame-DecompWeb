import { Effect } from "@babylonjs/core/Materials/effect";
import "@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration"; // registers the #include<instancesDeclaration> chunk
import "@babylonjs/core/Shaders/ShadersInclude/instancesVertex";

/**
 * The game's materials are fixed-function Direct3D 9 texture stages, so these are small unlit shaders that do the same arithmetic
 * (no engine lighting): lighting is baked into lightmaps and vertex-blended ground.
 */
export function registerShaders(): void {
  if (Effect.ShadersStore["otmTerrainVertexShader"]) return;

  // Ground: a flat quad. Blend weights of up to 8 ground textures come from two 256 x 256 maps (one texel per terrain vertex, filtered
  // bilinearly like vertex interpolation); the textures tile in world units. Paved path cells (nearest-filtered mask) show the sidewalk.
  Effect.ShadersStore["otmTerrainVertexShader"] = `
    attribute vec3 position;
    uniform mat4 worldViewProjection;
    varying vec2 vXZ;
    void main() {
      vXZ = position.xz;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }`;
  Effect.ShadersStore["otmTerrainFragmentShader"] = `
    precision highp float;
    varying vec2 vXZ;
    uniform sampler2D ground0; uniform sampler2D ground1; uniform sampler2D ground2; uniform sampler2D ground3;
    uniform sampler2D ground4; uniform sampler2D ground5; uniform sampler2D ground6; uniform sampler2D ground7;
    uniform sampler2D weightsA; uniform sampler2D weightsB; uniform sampler2D pathMask; uniform sampler2D sidewalk;
    uniform float tileSize;
    uniform float pathTileSize;
    uniform float pathOn;                 // 0 hides the sidewalk layer (debugging: __otm.paths(false))
    void main() {
      vec2 cell = (vXZ + 256.0) * 0.5;      // vertex units: vertex i is at world 2i - 256
      vec2 suv = (cell + 0.5) / 256.0;
      vec4 a = texture2D(weightsA, suv);
      vec4 b = texture2D(weightsB, suv);
      vec2 uv = vXZ / tileSize;
      vec3 c = texture2D(ground0, uv).rgb * a.x + texture2D(ground1, uv).rgb * a.y
             + texture2D(ground2, uv).rgb * a.z + texture2D(ground3, uv).rgb * a.w
             + texture2D(ground4, uv).rgb * b.x + texture2D(ground5, uv).rgb * b.y
             + texture2D(ground6, uv).rgb * b.z + texture2D(ground7, uv).rgb * b.w;
      // A path cell (x, y) covers vertex x to x + 1 (FUN_009e16b0 / FUN_00a797d0 draw it between those terrain vertices), not the 2 units centred on vertex x.
      float path = texture2D(pathMask, (floor(cell) + 0.5) / 256.0).r * pathOn;
      vec3 paved = texture2D(sidewalk, vXZ / pathTileSize).rgb;
      gl_FragColor = vec4(mix(c, paved, path), 1.0);
    }`;

  // Static models (drawn as hardware instances: one draw call per model and material, however often the save places it): diffuse texture, optionally multiplied by a lightmap on the second UV set, doubled (lightmaps are dark: 0.5 is neutral).
  const staticVertex = `
    attribute vec3 position;
    attribute vec2 uv;
    attribute vec2 uv2;
    #include<instancesDeclaration>
    uniform mat4 viewProjection;
    varying vec2 vUV;
    varying vec2 vUV2;
    void main() {
      #include<instancesVertex>
      vUV = uv;
      vUV2 = uv2;
      gl_Position = viewProjection * finalWorld * vec4(position, 1.0);
    }`;
  Effect.ShadersStore["otmStaticVertexShader"] = staticVertex;
  Effect.ShadersStore["otmDecalVertexShader"] = staticVertex;
  Effect.ShadersStore["otmStaticFragmentShader"] = `
    precision highp float;
    varying vec2 vUV;
    varying vec2 vUV2;
    uniform sampler2D diffuse;
    uniform sampler2D lightmap;
    uniform float useLightmap;
    void main() {
      vec4 d = texture2D(diffuse, vUV);
      if (d.a < 0.5) discard;
      vec3 c = d.rgb;
      if (useLightmap > 0.5) c *= texture2D(lightmap, vUV2).rgb * (255.0 / 127.0);
      gl_FragColor = vec4(min(c, vec3(1.0)), 1.0);
    }`;
  // Two-layer material (the gate's flag): a base texture (the cloth) with a second texture (the studio logo) laid over it by its alpha. The cloth uses the second UV set, the logo the first (clamped).
  Effect.ShadersStore["otmDecalFragmentShader"] = `
    precision highp float;
    varying vec2 vUV;
    varying vec2 vUV2;
    uniform sampler2D base;
    uniform sampler2D decal;
    void main() {
      // The cloth uses the second UV set (0..1); the logo the first, which runs past 0..1 (the flag's runs -0.43..1.43) so that the logo is drawn once with margin: nothing outside 0..1.
      vec4 b = texture2D(base, vUV2);
      vec4 d = texture2D(decal, vUV);
      if (vUV.x < 0.0 || vUV.x > 1.0 || vUV.y < 0.0 || vUV.y > 1.0) d.a = 0.0;
      // flag.dds is mid-grey (mean about 0.44): like a lightmapped surface the cloth is doubled (255/127, as in otmStatic), which makes the cloth near white.
      gl_FragColor = vec4(mix(min(b.rgb * (255.0 / 127.0), vec3(1.0)), d.rgb, d.a), 1.0); // the gain is on the cloth only: doubled, the logo washes out
    }`;
}
