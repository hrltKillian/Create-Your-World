/**
 * Instanced boxes (avatar, items, drops, particles): three texture-array layers (sides, top,
 * bottom), a light value and a texture mapping per box. Face UVs follow the chunk shader's
 * convention, from the box's place in texture space (`aTexOrigin.xyz` + position × `aTexSize`),
 * so a box cut from a block shows the same pixels as the block. Sprite boxes (`aTexOrigin.w` = 1,
 * items extruded from an icon) sample the icon plane on every face, staying inside their own
 * pixels, so their edges take the colour of the border pixels.
 */

export const boxVertex = /* glsl */ `
in vec3 aLayers;
in vec2 aLight;
in vec4 aTexOrigin;
in vec3 aTexSize;
out vec2 vUv;
flat out float vLayer;
out vec2 vLight;
out vec3 vNormal;
#include <fog_pars_vertex>

void main() {
  vec3 t = aTexOrigin.xyz + position * aTexSize;
  vLayer = aLayers.x;
  if (aTexOrigin.w > 0.5) vUv = aTexOrigin.xy + clamp(position.xy, 0.001, 0.999) * aTexSize.xy;
  else if (normal.x > 0.5) vUv = vec2(-t.z, t.y);
  else if (normal.x < -0.5) vUv = vec2(t.z, t.y);
  else if (normal.y > 0.5) {
    vUv = vec2(t.x, t.z);
    vLayer = aLayers.y;
  } else if (normal.y < -0.5) {
    vUv = vec2(t.x, -t.z);
    vLayer = aLayers.z;
  } else if (normal.z > 0.5) vUv = vec2(t.x, t.y);
  else vUv = vec2(-t.x, t.y);
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
uniform float uMinLight;
in vec2 vUv;
flat in float vLayer;
in vec2 vLight;
in vec3 vNormal;
#include <fog_pars_fragment>

float lightCurve(float level) {
  return pow(0.82, 15.0 * (1.0 - level));
}

void main() {
  vec3 base = texture(uTextures, vec3(vUv, vLayer)).rgb;
  vec3 light = max(lightCurve(vLight.x * uDaylight) * uSkyTint, lightCurve(vLight.y) * uTorchTint);
  light = max(light, vec3(uMinLight));
  // Simple directional shading so the boxes read as volumes.
  float shade = 0.72 + 0.28 * max(dot(vNormal, normalize(vec3(0.3, 1.0, 0.45))), 0.0);
  gl_FragColor = vec4(base * light * shade, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
