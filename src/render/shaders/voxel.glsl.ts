import { LIGHTING, MIST } from './lighting.glsl.ts';
import { SKY_GRADIENT } from './sky.glsl.ts';
import { WATER } from './water.glsl.ts';

/**
 * Chunk shader. Vertices are two packed uint words (see world/mesh/vertexFormat.ts); UVs are
 * derived from the position and the face, so merged quads repeat the texture per block.
 * GLSL ES 3.00: three.js adds the version line and its prefix; glslVersion stays null.
 */

/**
 * Light level (0–1) → brightness: each step down keeps 82 % (docs « Éclairage »); the player's
 * gamma (Settings, 0–1) lifts the dark end towards 1 − (1 − c)⁴ as the reference game's brightness
 * does. Shared by the chunk and the box shaders (they declare `uGamma`).
 */
export const LIGHT_CURVE = /* glsl */ `
float lightCurve(float level) {
  float c = pow(0.82, 15.0 * (1.0 - level));
  float d = 1.0 - c;
  return mix(c, 1.0 - d * d * d * d, uGamma);
}
`;

/**
 * A packed chunk vertex (world/mesh/vertexFormat.ts), shared by the chunk shader and the sun's
 * shadow pass: its position, the plants' sway and its texture coordinates.
 */
export const VOXEL_DECODE = /* glsl */ `
in uvec2 aPacked;
/** Wind: 1 calm, more in a storm (plan v4 « M40 »); plants sway that much further. */
uniform float uWind;
/** The sway's phase, advanced by the wind's speed (render/wind.ts, plan v5 « M46 »). */
uniform float uWindPhase;

uint voxelFace() {
  return (aPacked.y >> 9u) & 7u;
}

uint voxelFlags() {
  return (aPacked.y >> 29u) & 7u;
}

uint voxelAo() {
  return (aPacked.x >> 30u) & 3u;
}

float voxelLayer() {
  return float(aPacked.y & 511u);
}

/** The position in the mesh (blocks from its origin), before any sway. */
vec3 voxelBase() {
  uint w0 = aPacked.x;
  return vec3(float(w0 & 1023u), float((w0 >> 10u) & 1023u), float((w0 >> 20u) & 1023u)) / 16.0;
}

/** UVs from the position and the face (cross quads: their corner), turned by flag 4. */
vec2 voxelUv(vec3 pos) {
  uint face = voxelFace();
  uint ao = voxelAo();
  vec2 uv;
  if (face == 0u) uv = vec2(-pos.z, pos.y);
  else if (face == 1u) uv = vec2(pos.z, pos.y);
  else if (face == 2u) uv = vec2(pos.x, pos.z);
  else if (face == 3u) uv = vec2(pos.x, -pos.z);
  else if (face == 4u) uv = vec2(pos.x, pos.y);
  else if (face == 5u) uv = vec2(-pos.x, pos.y);
  else uv = vec2((ao == 1u || ao == 2u) ? 1.0 : 0.0, ao >= 2u ? 1.0 : 0.0);
  if ((voxelFlags() & 4u) != 0u) uv = vec2(uv.y, -uv.x);
  return uv;
}

/** Plants sway: only the top vertices of cross quads move. */
vec3 voxelSway(vec3 pos) {
  if ((voxelFlags() & 1u) != 0u && voxelFace() > 5u && voxelAo() >= 2u) {
    vec3 origin = mod(modelMatrix[3].xyz, 256.0);
    float phase = uWindPhase + (origin.x + pos.x) * 0.7 + (origin.z + pos.z) * 0.5;
    pos.x += 0.05 * uWind * sin(phase);
    pos.z += 0.05 * uWind * cos(phase * 0.8);
  }
  return pos;
}
`;

export const voxelVertex = /* glsl */ `
${VOXEL_DECODE}
uniform vec3 uTintColors[32];
out vec2 vUv;
flat out float vLayer;
out float vAo;
out float vSky;
out float vBlock;
flat out uint vFlags;
flat out uint vFace;
out vec3 vTint;
out vec2 vQuadUv;
out vec3 vWorld;
#include <fog_pars_vertex>

const float AO_LEVELS[4] = float[4](0.45, 0.65, 0.83, 1.0);

void main() {
  uint w1 = aPacked.y;
  uint face = voxelFace();
  vec3 base = voxelBase();
  vec3 pos = voxelSway(base);
  vUv = voxelUv(base);
  vLayer = voxelLayer();
  vAo = face > 5u ? 1.0 : AO_LEVELS[voxelAo()];
  vSky = float((w1 >> 12u) & 63u) / 60.0;
  vBlock = float((w1 >> 18u) & 63u) / 60.0;
  vFlags = voxelFlags();
  vFace = face;
  vTint = uTintColors[(w1 >> 24u) & 31u];
  int corner = gl_VertexID & 3;
  vQuadUv = vec2((corner == 1 || corner == 2) ? 1.0 : 0.0, corner >= 2 ? 1.0 : 0.0);

  vWorld = (modelMatrix * vec4(pos, 1.0)).xyz;
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #ifdef USE_FOG
  vFogDepth = length(mvPosition.xyz);
  #endif
}
`;

/** Texels under this alpha are holes in cutout layers (chunks and boxes). A GLSL float. */
export const CUTOUT_ALPHA = '0.35';

export const voxelFragment = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uTextures;
uniform sampler2DArray uMaterials;
uniform float uTime;
uniform float uDaylight;
uniform vec3 uTorchTint;
uniform float uFlicker;
uniform float uMinLight;
uniform float uGamma;
uniform float uOpacity;
uniform float uWetness;
uniform int uDebugView;
in vec2 vUv;
flat in float vLayer;
in float vAo;
in float vSky;
in float vBlock;
flat in uint vFlags;
flat in uint vFace;
in vec3 vTint;
in vec2 vQuadUv;
in vec3 vWorld;
#include <fog_pars_fragment>

const float FACE_SHADE[8] = float[8](0.8, 0.8, 1.0, 0.55, 0.68, 0.68, 0.9, 0.9);

// Each cube face's normal and the world directions of its texture's u and v (the UVs above).
const vec3 FACE_N[6] = vec3[6](
  vec3(1, 0, 0), vec3(-1, 0, 0), vec3(0, 1, 0), vec3(0, -1, 0), vec3(0, 0, 1), vec3(0, 0, -1));
const vec3 FACE_T[6] = vec3[6](
  vec3(0, 0, -1), vec3(0, 0, 1), vec3(1, 0, 0), vec3(1, 0, 0), vec3(1, 0, 0), vec3(-1, 0, 0));
const vec3 FACE_B[6] = vec3[6](
  vec3(0, 1, 0), vec3(0, 1, 0), vec3(0, 0, 1), vec3(0, 0, -1), vec3(0, 1, 0), vec3(0, 1, 0));
/** Rain wets surfaces under the open sky: this smooth, this much darker. */
const float WET_ROUGHNESS = 0.12;
const float WET_DARKEN = 0.25;
/** Lava (plan v4 « M38 »): its crust drifts this many textures a second, its glow pulses. */
const vec2 LAVA_DRIFT = vec2(0.021, 0.013);
const float LAVA_PULSE = 0.25;
/** Glowing plants glow this share of their texels; leaves let this much of the sun through. */
const float PLANT_GLOW = 0.5;
const float LEAF_GLOW = 0.6;
/** Water: the sun's glint on its surface; caustics' share of the sun's light under water. */
const float WATER_ROUGHNESS = 0.03;
const float CAUSTICS = 1.4;

${LIGHT_CURVE}
${LIGHTING}
${SKY_GRADIENT}
${MIST}
${WATER}

/** A cube face texel's normal: its face's, tilted by the material's relief (plan v4 « M36 »). */
vec3 reliefNormal(vec4 material) {
  vec3 t = FACE_T[vFace];
  vec3 b = FACE_B[vFace];
  // Turned faces (flag 4) map uv to (v, −u): u now runs along b and v against t.
  if ((vFlags & 4u) != 0u) { vec3 u = b; b = -t; t = u; }
  vec2 tilt = material.xy * 2.0 - 1.0;
  return t * tilt.x + b * tilt.y + FACE_N[vFace] * sqrt(max(0.0, 1.0 - dot(tilt, tilt)));
}

/** The face shades of old, smoothly over any normal: a torch lights faces without a direction. */
float torchShade(vec3 n) {
  vec3 n2 = n * n;
  return n2.x * 0.8 + n2.z * 0.68 + n2.y * (n.y > 0.0 ? 1.0 : 0.55);
}

void main() {
  bool liquid = liquidLayer(vLayer);
  vec2 uv = vUv;
  #if !defined(TRANSLUCENT) && !defined(ALPHA_CUTOUT)
  // An opaque liquid is lava: its crust drifts.
  if (liquid) uv += uTime * LAVA_DRIFT;
  #endif
  vec4 texel = texture(uTextures, vec3(uv, vLayer));
  #ifdef ALPHA_CUTOUT
  if (texel.a < ${CUTOUT_ALPHA}) discard;
  #endif

  vec3 base = texel.rgb;
  #if defined(ALPHA_CUTOUT) || defined(TRANSLUCENT)
  base *= vTint;
  // A glowing plant (emissive cutout faces) glows over most of it.
  float mask = (vFlags & 2u) != 0u ? PLANT_GLOW : 0.0;
  #else
  // Opaque layers use alpha as a mask: tint mask on tinted faces, emissive mask on emissive ones.
  float mask = texel.a;
  base *= mix(vec3(1.0), vTint, mask);
  #endif

  // Plants (cross quads) take the light of the ground they grow from.
  bool cube = vFace <= 5u;
  vec4 material = cube ? texture(uMaterials, vec3(uv, vLayer)) : vec4(0.5, 0.5, 0.85, 1.0);
  vec3 n = cube ? reliefNormal(material) : vec3(0.0, 1.0, 0.0);
  #ifdef TRANSLUCENT
  // A water surface: waves (and rain rings) tilt its top.
  if (liquid && vFace == 2u) {
    vec2 slope = waterSlope(vWorld.xz, uTime, uWetness);
    n = normalize(vec3(-slope.x, 1.0, -slope.y));
  }
  #endif
  // The sun reaches only cells open to the sky, and not those in a shadow.
  float open = smoothstep(0.8, 1.0, vSky);
  float lit = open * sunShadow(vWorld, n);
  float wet = uWetness * open * (0.4 + 0.6 * max(n.y, 0.0));
  base *= 1.0 - WET_DARKEN * wet;
  float occlusion = vAo * material.a;
  vec3 light = max(
    skyShade(lightCurve(vSky * uDaylight), n, lit, occlusion),
    lightCurve(vBlock) * uTorchTint * uFlicker * torchShade(n) * occlusion
  );
  float skyLevel = lightCurve(vSky * uDaylight);
  #if !defined(TRANSLUCENT)
  // Seen from under water, the sun's light wavers over every lit surface.
  if (uUnderwater > 0.0) light += uSunLight * (caustic(vWorld.xz, uTime) * CAUSTICS * skyLevel);
  #endif
  light = max(light, vec3(uMinLight));
  vec3 view = normalize(cameraPosition - vWorld);
  float roughness = liquid ? WATER_ROUGHNESS : mix(material.b, WET_ROUGHNESS, wet);
  vec3 color = base * light + sunGloss(n, view, roughness, lit) * skyLevel;
  #ifdef ALPHA_CUTOUT
  // Leaves glow with the sun behind them.
  if (cube) color += base * uSunLight * (pow(max(dot(-view, uSunDir), 0.0), 4.0) * LEAF_GLOW * open);
  #endif
  if ((vFlags & 2u) != 0u) {
    // Lava's glow pulses slowly, place by place; all glows shine brighter in the dark.
    float pulse = liquid ? 1.0 + LAVA_PULSE * sin(uTime * 1.3 + vWorld.x * 0.7 + vWorld.z * 0.5) : 1.0;
    color = mix(color, base * pulse * glowGain(skyLevel), mask);
  }
  float alpha = uOpacity;
  #ifdef TRANSLUCENT
  if (liquid) {
    // Fresnel: water reflects the sky more as the view grazes it (and the sky's light dims it).
    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, view), 0.0), 5.0);
    color = mix(color, skyGradient(reflect(-view, n)) * skyLevel, fresnel);
    alpha = mix(uOpacity, 1.0, fresnel);
  }
  #endif

  if (uDebugView == 1) {
    vec2 edge = min(vQuadUv, 1.0 - vQuadUv);
    vec2 width = fwidth(vQuadUv) * 1.5;
    if (edge.x < width.x || edge.y < width.y) color = vec3(0.02);
  } else if (uDebugView == 2) {
    color = vec3(vAo);
  } else if (uDebugView == 3) {
    color = vec3(max(vSky * uDaylight, vBlock));
  } else if (uDebugView == 4) {
    // X-ray: unlit (ores deep in the ground have no light), terrain ghosts nearly transparent.
    color = base * FACE_SHADE[vFace];
  }

  #ifdef TRANSLUCENT
  gl_FragColor = vec4(color, uDebugView == 4 ? 0.12 : alpha);
  #else
  gl_FragColor = vec4(color, 1.0);
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb = fogged(gl_FragColor.rgb, vWorld);
}
`;
