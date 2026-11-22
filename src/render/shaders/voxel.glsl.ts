/**
 * Chunk shader. Vertices are two packed uint words (see world/mesh/vertexFormat.ts); UVs are
 * derived from the position and the face, so merged quads repeat the texture per block.
 * GLSL ES 3.00: three.js adds the version line and its prefix; glslVersion stays null.
 */

export const voxelVertex = /* glsl */ `
in uvec2 aPacked;
uniform vec3 uTintColors[32];
uniform float uTime;
out vec2 vUv;
flat out float vLayer;
out float vAo;
out float vSky;
out float vBlock;
flat out uint vFlags;
flat out uint vFace;
out vec3 vTint;
out vec2 vQuadUv;
#include <fog_pars_vertex>

const float AO_LEVELS[4] = float[4](0.45, 0.65, 0.83, 1.0);

void main() {
  uint w0 = aPacked.x;
  uint w1 = aPacked.y;
  vec3 pos = vec3(float(w0 & 1023u), float((w0 >> 10u) & 1023u), float((w0 >> 20u) & 1023u)) / 16.0;
  uint ao = (w0 >> 30u) & 3u;
  uint face = (w1 >> 9u) & 7u;
  uint flags = (w1 >> 29u) & 7u;

  vec2 uv;
  if (face == 0u) uv = vec2(-pos.z, pos.y);
  else if (face == 1u) uv = vec2(pos.z, pos.y);
  else if (face == 2u) uv = vec2(pos.x, pos.z);
  else if (face == 3u) uv = vec2(pos.x, -pos.z);
  else if (face == 4u) uv = vec2(pos.x, pos.y);
  else if (face == 5u) uv = vec2(-pos.x, pos.y);
  else uv = vec2((ao == 1u || ao == 2u) ? 1.0 : 0.0, ao >= 2u ? 1.0 : 0.0);
  if ((flags & 4u) != 0u) uv = vec2(uv.y, -uv.x);

  // Plants sway: only the top vertices of cross quads move.
  if ((flags & 1u) != 0u && face > 5u && ao >= 2u) {
    vec3 origin = mod(modelMatrix[3].xyz, 256.0);
    float phase = uTime * 1.7 + (origin.x + pos.x) * 0.7 + (origin.z + pos.z) * 0.5;
    pos.x += 0.05 * sin(phase);
    pos.z += 0.05 * cos(phase * 0.8);
  }

  vUv = uv;
  vLayer = float(w1 & 511u);
  vAo = face > 5u ? 1.0 : AO_LEVELS[ao];
  vSky = float((w1 >> 12u) & 63u) / 60.0;
  vBlock = float((w1 >> 18u) & 63u) / 60.0;
  vFlags = flags;
  vFace = face;
  vTint = uTintColors[(w1 >> 24u) & 31u];
  int corner = gl_VertexID & 3;
  vQuadUv = vec2((corner == 1 || corner == 2) ? 1.0 : 0.0, corner >= 2 ? 1.0 : 0.0);

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #ifdef USE_FOG
  vFogDepth = length(mvPosition.xyz);
  #endif
}
`;

export const voxelFragment = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uTextures;
uniform float uDaylight;
uniform vec3 uSkyTint;
uniform vec3 uTorchTint;
uniform float uMinLight;
uniform float uOpacity;
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
#include <fog_pars_fragment>

const float FACE_SHADE[8] = float[8](0.8, 0.8, 1.0, 0.55, 0.68, 0.68, 0.9, 0.9);

float lightCurve(float level) {
  return pow(0.82, 15.0 * (1.0 - level));
}

void main() {
  vec4 texel = texture(uTextures, vec3(vUv, vLayer));
  #ifdef ALPHA_CUTOUT
  if (texel.a < 0.35) discard;
  #endif

  vec3 base = texel.rgb;
  #if defined(ALPHA_CUTOUT) || defined(TRANSLUCENT)
  base *= vTint;
  float mask = 0.0;
  #else
  // Opaque layers use alpha as a mask: tint mask on tinted faces, emissive mask on emissive ones.
  float mask = texel.a;
  base *= mix(vec3(1.0), vTint, mask);
  #endif

  vec3 light = max(lightCurve(vSky * uDaylight) * uSkyTint, lightCurve(vBlock) * uTorchTint);
  light = max(light, vec3(uMinLight));
  vec3 color = base * light * vAo * FACE_SHADE[vFace];
  if ((vFlags & 2u) != 0u) color = mix(color, base, mask);

  if (uDebugView == 1) {
    vec2 edge = min(vQuadUv, 1.0 - vQuadUv);
    vec2 width = fwidth(vQuadUv) * 1.5;
    if (edge.x < width.x || edge.y < width.y) color = vec3(0.02);
  } else if (uDebugView == 2) {
    color = vec3(vAo);
  } else if (uDebugView == 3) {
    color = vec3(max(vSky * uDaylight, vBlock));
  }

  #ifdef TRANSLUCENT
  gl_FragColor = vec4(color, uOpacity);
  #else
  gl_FragColor = vec4(color, 1.0);
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
