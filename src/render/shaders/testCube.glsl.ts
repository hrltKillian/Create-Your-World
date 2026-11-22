/** M0 test cube: samples one texture-array layer per face. GLSL ES 3.00 (three adds the prefix). */

export const testCubeVertex = /* glsl */ `
in float aLayer;
out vec2 vUv;
flat out float vLayer;
out vec3 vNormal;

void main() {
  vUv = uv;
  vLayer = aLayer;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const testCubeFragment = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uTextures;
uniform vec3 uLightDir;
in vec2 vUv;
flat in float vLayer;
in vec3 vNormal;

void main() {
  vec4 texel = texture(uTextures, vec3(vUv, vLayer));
  float diffuse = max(dot(normalize(vNormal), uLightDir), 0.0);
  gl_FragColor = vec4(texel.rgb * (0.45 + 0.55 * diffuse), 1.0);
  #include <colorspace_fragment>
}
`;
