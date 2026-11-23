import { CUTOUT_ALPHA } from './voxel.glsl.ts';

/**
 * Instanced boxes (avatar, items, drops, particles): three texture-array layers (sides, top,
 * bottom) with their tints, a light value and a texture mapping per box. Face UVs follow the chunk
 * shader's convention, from the box's place in texture space (`aTexOrigin.xyz` + position ×
 * `aTexSize`), so a box cut from a block shows the same pixels as the block. Sprite boxes
 * (`aTexOrigin.w` = 1, items extruded from an icon) sample the icon plane on every face, staying
 * inside their own pixels, so their edges take the colour of the border pixels. `aTints` holds the
 * side, top and bottom tints (linear RGB packed as 0xRRGGBB) and the alpha mode (1: cutout).
 */

export const boxVertex = /* glsl */ `
in vec3 aLayers;
in vec2 aLight;
in vec4 aTexOrigin;
in vec3 aTexSize;
in vec4 aTints;
out vec2 vUv;
flat out float vLayer;
flat out vec3 vTint;
flat out float vCutout;
out vec2 vLight;
out vec3 vNormal;
#include <fog_pars_vertex>

// Exact: the divisions are by powers of two and the packed value is an integer below 2^24.
vec3 unpackTint(float packed) {
  return mod(floor(packed / vec3(65536.0, 256.0, 1.0)), 256.0) / 255.0;
}

void main() {
  vec3 t = aTexOrigin.xyz + position * aTexSize;
  vLayer = aLayers.x;
  float tint = aTints.x;
  if (aTexOrigin.w > 0.5) vUv = aTexOrigin.xy + clamp(position.xy, 0.001, 0.999) * aTexSize.xy;
  else if (normal.x > 0.5) vUv = vec2(-t.z, t.y);
  else if (normal.x < -0.5) vUv = vec2(t.z, t.y);
  else if (normal.y > 0.5) {
    vUv = vec2(t.x, t.z);
    vLayer = aLayers.y;
    tint = aTints.y;
  } else if (normal.y < -0.5) {
    vUv = vec2(t.x, -t.z);
    vLayer = aLayers.z;
    tint = aTints.z;
  } else if (normal.z > 0.5) vUv = vec2(t.x, t.y);
  else vUv = vec2(-t.x, t.y);
  vTint = unpackTint(tint);
  vCutout = aTints.w;
  vLight = aLight;
  vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #ifdef USE_FOG
  vFogDepth = length(mvPosition.xyz);
  #endif
}
`;

export const boxFragment = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uTextures;
uniform float uDaylight;
uniform vec3 uSkyTint;
uniform vec3 uTorchTint;
uniform float uFlicker;
uniform float uMinLight;
in vec2 vUv;
flat in float vLayer;
flat in vec3 vTint;
flat in float vCutout;
in vec2 vLight;
in vec3 vNormal;
#include <fog_pars_fragment>

float lightCurve(float level) {
  return pow(0.82, 15.0 * (1.0 - level));
}

void main() {
  vec4 texel = texture(uTextures, vec3(vUv, vLayer));
  // As in the chunks: cutout layers use alpha as coverage and take the tint whole; opaque layers
  // never discard and use alpha as the tint mask.
  bool cutout = vCutout > 0.5;
  if (cutout && texel.a < ${CUTOUT_ALPHA}) discard;
  vec3 base = texel.rgb * mix(vec3(1.0), vTint, cutout ? 1.0 : texel.a);
  vec3 light = max(
    lightCurve(vLight.x * uDaylight) * uSkyTint,
    lightCurve(vLight.y) * uTorchTint * uFlicker
  );
  light = max(light, vec3(uMinLight));
  // Simple directional shading so the boxes read as volumes.
  float shade = 0.72 + 0.28 * max(dot(vNormal, normalize(vec3(0.3, 1.0, 0.45))), 0.0);
  gl_FragColor = vec4(base * light * shade, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
