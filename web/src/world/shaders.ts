import { Effect } from "@babylonjs/core/Materials/effect";

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
      float path = texture2D(pathMask, suv).r;
      vec3 paved = texture2D(sidewalk, vXZ / pathTileSize).rgb;
      gl_FragColor = vec4(mix(c, paved, path), 1.0);
    }`;

  // Static models: diffuse texture, optionally multiplied by a lightmap on the second UV set, doubled (lightmaps are dark: 0.5 is neutral).
  Effect.ShadersStore["otmStaticVertexShader"] = `
    attribute vec3 position;
    attribute vec2 uv;
    attribute vec2 uv2;
    uniform mat4 worldViewProjection;
    varying vec2 vUV;
    varying vec2 vUV2;
    void main() {
      vUV = uv;
      vUV2 = uv2;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }`;
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
}
