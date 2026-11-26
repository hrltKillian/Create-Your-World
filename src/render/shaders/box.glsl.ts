import { LIGHTING, MIST } from './lighting.glsl.ts';
import { SKY_GRADIENT } from './sky.glsl.ts';
import { CUTOUT_ALPHA, LIGHT_CURVE } from './voxel.glsl.ts';

/**
 * Instanced boxes (avatar, creatures, items, drops, particles): three texture-array layers (sides,
 * top, bottom) with their tints, a light value and a texture mapping per box. Face UVs follow the
 * chunk shader's convention, from the box's place in texture space (`aTexOrigin.xyz` + position ×
 * `aTexSize`), so a box cut from a block shows the same pixels as the block. Sprite boxes
 * (`aTexOrigin.w` = 1, items extruded from an icon) sample the icon plane on every face, staying
 * inside their own pixels, so their edges take the colour of the border pixels. `aTints` holds the
 * side, top and bottom tints (linear RGB packed as 0xRRGGBB) and the alpha mode (1: cutout). `aFx`
 * holds the glow (1: full brightness, a creature's eyes) and the red flash of a hurt creature.
 */

export const boxVertex = /* glsl */ `
in vec3 aLayers;
in vec2 aLight;
in vec4 aTexOrigin;
in vec3 aTexSize;
in vec4 aTints;
in vec2 aFx;
out vec2 vUv;
flat out float vLayer;
flat out vec3 vTint;
flat out float vCutout;
flat out vec2 vFx;
out vec2 vLight;
out vec3 vNormal;
out vec3 vWorld;
/** The face's texture directions in the world (plan v4 « M41 »: relief); zero on sprites. */
out vec3 vTangent;
out vec3 vBitangent;
#include <fog_pars_vertex>

// Exact: the divisions are by powers of two and the packed value is an integer below 2^24.
vec3 unpackTint(float packed) {
  return mod(floor(packed / vec3(65536.0, 256.0, 1.0)), 256.0) / 255.0;
}

void main() {
  vec3 t = aTexOrigin.xyz + position * aTexSize;
  vLayer = aLayers.x;
  float tint = aTints.x;
  // u and v of each face as the chunks map them, and their directions on the box (relief).
  vec3 tu = vec3(0.0);
  vec3 tv = vec3(0.0);
  if (aTexOrigin.w > 0.5) vUv = aTexOrigin.xy + clamp(position.xy, 0.001, 0.999) * aTexSize.xy;
  else if (normal.x > 0.5) {
    vUv = vec2(-t.z, t.y);
    tu = vec3(0.0, 0.0, -1.0);
    tv = vec3(0.0, 1.0, 0.0);
  } else if (normal.x < -0.5) {
    vUv = vec2(t.z, t.y);
    tu = vec3(0.0, 0.0, 1.0);
    tv = vec3(0.0, 1.0, 0.0);
  } else if (normal.y > 0.5) {
    vUv = vec2(t.x, t.z);
    vLayer = aLayers.y;
    tint = aTints.y;
    tu = vec3(1.0, 0.0, 0.0);
    tv = vec3(0.0, 0.0, 1.0);
  } else if (normal.y < -0.5) {
    vUv = vec2(t.x, -t.z);
    vLayer = aLayers.z;
    tint = aTints.z;
    tu = vec3(1.0, 0.0, 0.0);
    tv = vec3(0.0, 0.0, -1.0);
  } else if (normal.z > 0.5) {
    vUv = vec2(t.x, t.y);
    tu = vec3(1.0, 0.0, 0.0);
    tv = vec3(0.0, 1.0, 0.0);
  } else {
    vUv = vec2(-t.x, t.y);
    tu = vec3(-1.0, 0.0, 0.0);
    tv = vec3(0.0, 1.0, 0.0);
  }
  vTint = unpackTint(tint);
  vCutout = aTints.w;
  vFx = aFx;
  vLight = aLight;
  mat3 turn = mat3(modelMatrix * instanceMatrix);
  vNormal = normalize(turn * normal);
  vTangent = tu == vec3(0.0) ? tu : normalize(turn * tu);
  vBitangent = tv == vec3(0.0) ? tv : normalize(turn * tv);
  vWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
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
uniform sampler2DArray uMaterials;
uniform float uDaylight;
uniform vec3 uTorchTint;
uniform float uFlicker;
uniform float uMinLight;
uniform float uGamma;
in vec2 vUv;
flat in float vLayer;
flat in vec3 vTint;
flat in float vCutout;
flat in vec2 vFx;
in vec2 vLight;
in vec3 vNormal;
in vec3 vWorld;
in vec3 vTangent;
in vec3 vBitangent;
#include <fog_pars_fragment>

${LIGHT_CURVE}
${LIGHTING}
${SKY_GRADIENT}
${MIST}

void main() {
  vec4 texel = texture(uTextures, vec3(vUv, vLayer));
  // As in the chunks: cutout layers use alpha as coverage and take the tint whole; opaque layers
  // never discard and use alpha as the tint mask.
  bool cutout = vCutout > 0.5;
  if (cutout && texel.a < ${CUTOUT_ALPHA}) discard;
  vec3 base = texel.rgb * mix(vec3(1.0), vTint, cutout ? 1.0 : texel.a);
  // The sky's light as on the blocks (plan v4 « M37 »), the torch's from every side a little less
  // below; glowing boxes ignore both.
  // The relief of the skin's material (plan v4 « M41 »), as on the blocks; sprites stay flat.
  vec3 n = vNormal;
  float cavity = 1.0;
  if (dot(vTangent, vTangent) > 0.5) {
    vec4 material = texture(uMaterials, vec3(vUv, vLayer));
    vec2 tilt = material.xy * 2.0 - 1.0;
    n = normalize(vTangent * tilt.x + vBitangent * tilt.y + vNormal * sqrt(max(0.0, 1.0 - dot(tilt, tilt))));
    cavity = material.a;
  }
  float sun = smoothstep(0.8, 1.0, vLight.x) * sunShadow(vWorld, vNormal);
  vec3 light = max(
    skyShade(lightCurve(vLight.x * uDaylight), n, sun, cavity),
    lightCurve(vLight.y) * uTorchTint * uFlicker * (0.8 + 0.2 * n.y) * cavity
  );
  light = max(light, vec3(uMinLight));
  vec3 lit = mix(base * light, base * glowGain(lightCurve(vLight.x * uDaylight)), vFx.x);
  gl_FragColor = vec4(mix(lit, vec3(0.85, 0.08, 0.05), vFx.y * 0.6), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb = fogged(gl_FragColor.rgb, vWorld);
}
`;
