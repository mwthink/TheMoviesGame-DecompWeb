import { Effect } from "@babylonjs/core/Materials/effect";
import "@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration"; // registers the #include<instancesDeclaration> chunk
import "@babylonjs/core/Shaders/ShadersInclude/instancesVertex";

/**
 * The game's materials are fixed-function Direct3D 9 texture stages, so these are small unlit shaders that do the same arithmetic
 * (no engine lighting): lighting is baked into lightmaps and vertex-blended ground.
 */
/** Shadow lookup shared by the shaders that receive the sun's shadows (docs/LIGHTING.md). The map holds depth packed into four bytes. */
const SHADOW_FUNCTIONS = `
    uniform sampler2D shadowMap;
    uniform float shadowOn;
    uniform vec3 shadowParams;
    float unpackDepth(vec4 c) { return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }
    float shadowFactor(vec3 s) {
      if (shadowOn < 0.5 || s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
      float sum = 0.0;
      for (int i = -1; i <= 1; i++) {
        for (int j = -1; j <= 1; j++) {
          float stored = unpackDepth(texture2D(shadowMap, s.xy + vec2(float(i), float(j)) * shadowParams.z));
          sum += (s.z - shadowParams.x <= stored) ? 1.0 : 0.0;
        }
      }
      return sum / 9.0;
    }`;

export function registerShaders(): void {
  if (Effect.ShadersStore["otmTerrainVertexShader"]) return;

  // Ground: a flat quad. Blend weights of up to 8 ground textures come from two 256 x 256 maps (one texel per terrain vertex, filtered
  // bilinearly like vertex interpolation); the textures tile in world units. Paved path cells (nearest-filtered mask) show the sidewalk.
  Effect.ShadersStore["otmTerrainVertexShader"] = `
    attribute vec3 position;
    uniform mat4 worldViewProjection;
    uniform mat4 shadowMatrix;
    varying vec2 vXZ;
    varying vec3 vShadow;
    void main() {
      vXZ = position.xz;
      vShadow = (shadowMatrix * vec4(position, 1.0)).xyz;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }`;
  Effect.ShadersStore["otmTerrainFragmentShader"] = `
    precision highp float;
    varying vec2 vXZ;
    varying vec3 vShadow;
    ${SHADOW_FUNCTIONS}
    uniform sampler2D ground0; uniform sampler2D ground1; uniform sampler2D ground2; uniform sampler2D ground3;
    uniform sampler2D ground4; uniform sampler2D ground5; uniform sampler2D ground6; uniform sampler2D ground7;
    uniform sampler2D weightsA; uniform sampler2D weightsB; uniform sampler2D pathMask; uniform sampler2D sidewalk;
    uniform float tileSize;
    uniform float pathTileSize;
    uniform float pathOn;                 // 0 hides the sidewalk layer (debugging: __otm.paths(false))
    uniform float sunOn;
    uniform vec3 sunDir;
    uniform vec3 sunParams;
    uniform float debugMode;
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
      vec3 col = mix(c, paved, path);
      if (debugMode > 0.5) {
        if (debugMode < 1.5) gl_FragColor = vec4(col, 1.0);
        else if (debugMode < 2.5) gl_FragColor = vec4(1.0);
        else if (debugMode < 3.5) gl_FragColor = vec4(0.5, 1.0, 0.5, 1.0);
        else if (debugMode < 4.5) gl_FragColor = vec4(vec3(max(sunDir.y, 0.0)), 1.0);
        else gl_FragColor = vec4(vec3(shadowFactor(vShadow)), 1.0);
        return;
      }
      if (sunOn > 0.5) {
        float sh = shadowFactor(vShadow);
        col *= (sunParams.z + sunParams.y) * (1.0 - shadowParams.y * (1.0 - sh)) + sunParams.x * max(sunDir.y, 0.0) * sh;
      }
      gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
    }`;

  // Static models (drawn as hardware instances: one draw call per model and material, however often the save places it): diffuse texture, optionally multiplied by a lightmap on the second UV set, doubled (lightmaps are dark: 0.5 is neutral).
  const staticVertex = `
    attribute vec3 position;
    attribute vec2 uv;
    attribute vec2 uv2;
    attribute vec3 normal;
    #include<instancesDeclaration>
    uniform mat4 viewProjection;
    uniform mat4 shadowMatrix;
    varying vec2 vUV;
    varying vec2 vUV2;
    varying float vY;
    varying vec3 vNormal;
    varying vec3 vShadow;
    void main() {
      #include<instancesVertex>
      vNormal = mat3(finalWorld) * normal;
      vShadow = (shadowMatrix * finalWorld * vec4(position, 1.0)).xyz;
      vUV = uv;
      vUV2 = uv2;
      vY = (finalWorld * vec4(position, 1.0)).y;
      gl_Position = viewProjection * finalWorld * vec4(position, 1.0);
    }`;
  Effect.ShadersStore["otmStaticVertexShader"] = staticVertex;
  Effect.ShadersStore["otmDecalVertexShader"] = staticVertex;
  Effect.ShadersStore["otmStaticFragmentShader"] = `
    precision highp float;
    varying vec2 vUV;
    varying vec2 vUV2;
    varying float vY;
    varying vec3 vNormal;
    varying vec3 vShadow;
    ${SHADOW_FUNCTIONS}
    uniform float cutHeight;
    uniform sampler2D diffuse;
    uniform sampler2D lightmap;
    uniform float useLightmap;
    uniform float sunOn;
    uniform vec3 sunDir;
    uniform vec3 sunParams;
    uniform float debugMode;
    void main() {
      if (vY > cutHeight) discard;
      vec4 d = texture2D(diffuse, vUV);
      if (d.a < 0.5) discard;
      vec3 c = d.rgb;
      if (debugMode > 0.5) {
        vec3 n = normalize(vNormal);
        vec3 lmv = useLightmap > 0.5 ? texture2D(lightmap, vUV2).rgb * (255.0 / 127.0) : vec3(1.0);
        if (debugMode < 1.5) gl_FragColor = vec4(d.rgb, 1.0);
        else if (debugMode < 2.5) gl_FragColor = vec4(min(lmv, vec3(1.0)), 1.0);
        else if (debugMode < 3.5) gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
        else if (debugMode < 4.5) gl_FragColor = vec4(vec3(max(dot(n, sunDir), 0.0)), 1.0);
        else gl_FragColor = vec4(vec3(shadowFactor(vShadow)), 1.0);
        return;
      }
      if (sunOn > 0.5) {
        vec3 lm = useLightmap > 0.5 ? texture2D(lightmap, vUV2).rgb * (255.0 / 127.0) : vec3(1.0);
        float ndl = max(dot(normalize(vNormal), sunDir), 0.0);
        float sh = shadowFactor(vShadow);
        c *= (sunParams.z * lm + sunParams.y) * (1.0 - shadowParams.y * (1.0 - sh)) + sunParams.x * ndl * sh;
      } else if (useLightmap > 0.5) c *= texture2D(lightmap, vUV2).rgb * (255.0 / 127.0);
      gl_FragColor = vec4(min(c, vec3(1.0)), 1.0);
    }`;
  // Shadow map pass: the depth of each caster as seen from the sun, packed into four bytes. A caster with a diffuse texture is alpha tested like the main pass,
  // and a cut model drops what is above its cut height.
  Effect.ShadersStore["otmDepthVertexShader"] = `
    attribute vec3 position;
    attribute vec2 uv;
    #include<instancesDeclaration>
    uniform mat4 shadowMatrix;
    varying vec2 vUV;
    varying float vY;
    varying float vDepth;
    void main() {
      #include<instancesVertex>
      vec4 wp = finalWorld * vec4(position, 1.0);
      vec3 s = (shadowMatrix * wp).xyz;
      vUV = uv;
      vY = wp.y;
      vDepth = s.z;
      gl_Position = vec4(s.xy * 2.0 - 1.0, s.z * 2.0 - 1.0, 1.0);
    }`;
  Effect.ShadersStore["otmDepthFragmentShader"] = `
    precision highp float;
    varying vec2 vUV;
    varying float vY;
    varying float vDepth;
    uniform sampler2D diffuse;
    uniform float cutHeight;
    uniform float alphaTest;
    vec4 packDepth(float d) {
      vec4 enc = fract(d * vec4(1.0, 255.0, 65025.0, 16581375.0));
      enc -= enc.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
      return enc;
    }
    void main() {
      if (vY > cutHeight) discard;
      if (alphaTest > 0.5 && texture2D(diffuse, vUV).a < 0.5) discard;
      gl_FragColor = packDepth(clamp(vDepth, 0.0, 0.999999));
    }`;
  // Two-layer material (the gate's flag): a base texture (the cloth) with a second texture (the studio logo) laid over it by its alpha. The cloth uses the second UV set, the logo the first (clamped).
  Effect.ShadersStore["otmDecalFragmentShader"] = `
    precision highp float;
    varying vec2 vUV;
    varying vec2 vUV2;
    varying float vY;
    uniform float cutHeight;
    uniform sampler2D base;
    uniform sampler2D decal;
    void main() {
      if (vY > cutHeight) discard;
      vec4 b = texture2D(base, vUV2);
      vec4 d = texture2D(decal, vUV);
      if (vUV.x < 0.0 || vUV.x > 1.0 || vUV.y < 0.0 || vUV.y > 1.0) d.a = 0.0;
      // flag.dds is mid-grey (mean about 0.44): like a lightmapped surface the cloth is doubled (255/127, as in otmStatic), which makes the cloth near white.
      gl_FragColor = vec4(mix(min(b.rgb * (255.0 / 127.0), vec3(1.0)), d.rgb, d.a), 1.0); // the gain is on the cloth only: doubled, the logo washes out
    }`;
  // Flat colour or texture (the room floors and their wall outlines). Plain mesh, not instanced.
  Effect.ShadersStore["otmFlatVertexShader"] = `
    precision highp float;
    attribute vec3 position;
    attribute vec2 uv;
    uniform mat4 world;
    uniform mat4 viewProjection;
    varying vec2 vUV;
    void main() {
      vUV = uv;
      gl_Position = viewProjection * world * vec4(position, 1.0);
    }`;
  Effect.ShadersStore["otmFlatFragmentShader"] = `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D tex;
    uniform vec4 tint;
    uniform float useTex;
    void main() {
      if (useTex > 0.5) {
        vec4 c = texture2D(tex, vUV);
        if (c.a < 0.05) discard; // transparent texels (the background of the room text) draw nothing
        gl_FragColor = c;
      } else {
        gl_FragColor = tint;
      }
    }`;
}
