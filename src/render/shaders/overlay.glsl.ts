/**
 * Block overlays: the crack decal (MULTIPLY: it darkens what is under it, so it is lit like the
 * block) and the translucent placement ghost. One texture-array layer per box face, picked from
 * `uFaceLayers` by the face attribute (BoxGeometry face order matches the registry's).
 */

export const overlayVertex = /* glsl */ `
in float aFace;
uniform float uFaceLayers[6];
out vec2 vUv;
flat out float vLayer;

void main() {
  vUv = uv;
  vLayer = uFaceLayers[int(aFace + 0.5)];
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const overlayFragment = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uTextures;
uniform float uOpacity;
in vec2 vUv;
flat in float vLayer;

void main() {
  vec4 texel = texture(uTextures, vec3(vUv, vLayer));
  #ifdef MULTIPLY
  // Blended as destination × source: white leaves the block unchanged.
  gl_FragColor = vec4(mix(vec3(1.0), texel.rgb, texel.a), 1.0);
  #else
  gl_FragColor = vec4(texel.rgb, texel.a * uOpacity);
  #include <colorspace_fragment>
  #endif
}
`;
