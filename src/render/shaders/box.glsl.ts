/** Instanced boxes (avatar, creatures, items): one texture-array layer and one light value per box. */

export const boxVertex = /* glsl */ `
in float aLayer;
in vec2 aLight;
out vec2 vUv;
flat out float vLayer;
out vec2 vLight;
out vec3 vNormal;
#include <fog_pars_vertex>

void main() {
  vUv = uv;
  vLayer = aLayer;
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
