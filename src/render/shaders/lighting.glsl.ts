/**
 * The sky's light on surfaces (plan v4 « M37 »), shared by the chunk and the box shaders: a
 * hemisphere of ambient light, the direct light of the sun (or the moon) with its shadow map, and
 * its highlight on glossy surfaces. `uSunDir` points towards the light. The uniforms come from
 * `sunLight.ts` and `SunShadow.ts` through WorldView.
 */
export const LIGHTING = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunLight;
uniform vec3 uSkyLight;
uniform vec3 uGroundLight;
precision highp sampler2DShadow;
uniform sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowTexel;
uniform float uShadowStrength;

// 1 lit, 0 in the shadow of the sun; lit outside the map, or with shadows off (strength 0: three
// binds an empty depth texture). The point moves a little along its normal first, so a face does
// not shadow itself.
float sunShadow(vec3 worldPos, vec3 n) {
  if (uShadowStrength <= 0.0) return 1.0;
  vec3 p = (uShadowMatrix * vec4(worldPos + n * 0.08, 1.0)).xyz;
  vec2 edge = min(p.xy, 1.0 - p.xy);
  if (min(edge.x, edge.y) <= 0.0 || p.z >= 1.0) return 1.0;
  float d = uShadowTexel * 0.6;
  float z = p.z - 0.0004;
  // Four compared taps, each filtered by the hardware: soft edges a texel wide.
  float lit = 0.25 * (
    texture(uShadowMap, vec3(p.xy + vec2(-d, -d), z)) +
    texture(uShadowMap, vec3(p.xy + vec2(d, -d), z)) +
    texture(uShadowMap, vec3(p.xy + vec2(-d, d), z)) +
    texture(uShadowMap, vec3(p.xy + vec2(d, d), z)));
  float fade = smoothstep(0.0, 0.08, min(edge.x, edge.y));
  return mix(1.0, lit, fade * uShadowStrength);
}

// The sky's light on a surface: 'level' the cell's sky light through the light curve, 'n' its
// normal, 'lit' the sun's share reaching it (shadow × open sky), 'occlusion' how much of the sky it
// sees (ambient occlusion and cavity).
vec3 skyShade(float level, vec3 n, float lit, float occlusion) {
  vec3 ambient = mix(uGroundLight, uSkyLight, n.y * 0.5 + 0.5) * occlusion;
  vec3 direct = uSunLight * max(dot(n, uSunDir), 0.0) * lit * (0.5 + 0.5 * occlusion);
  return level * (ambient + direct);
}

// The sun's highlight on a glossy surface (Blinn-Phong): roughness 0 a mirror, 1 matte.
vec3 sunGloss(vec3 n, vec3 view, float roughness, float lit) {
  float gloss = 1.0 - roughness;
  if (gloss < 0.05) return vec3(0.0);
  float power = exp2(1.0 + 9.0 * gloss);
  float facing = pow(max(dot(n, normalize(uSunDir + view)), 0.0), power);
  return uSunLight * (facing * gloss * gloss * max(dot(n, uSunDir), 0.0) * lit);
}
`;

/**
 * Distance fog (three's `Fog` uniforms), thickened in the low ground by a mist (plan v4 « M37 »):
 * `uMist` 0–1 below `uMistLine`, fading out MIST_DEPTH blocks above it, never right at the eye.
 * The fog takes the sun's haze towards the sun, as the sky behind it does (`skyHaze`, « M39 »:
 * SKY_GRADIENT comes first). Replaces three's fog chunk; without fog (the hand) the colour is
 * left as is.
 */
export const MIST = /* glsl */ `
uniform float uMist;
uniform float uMistLine;
const float MIST_DEPTH = 12.0;

vec3 fogged(vec3 color, vec3 world) {
  #ifdef USE_FOG
  float far = smoothstep(fogNear, fogFar, vFogDepth);
  float low = clamp(1.0 - (world.y - uMistLine) / MIST_DEPTH, 0.0, 1.0);
  float mist = uMist * low * smoothstep(4.0, fogFar * 0.5, vFogDepth);
  vec3 air = fogColor + skyHaze(normalize(world - cameraPosition), uSunDir);
  return mix(color, air, max(far, mist));
  #else
  return color;
  #endif
}
`;
