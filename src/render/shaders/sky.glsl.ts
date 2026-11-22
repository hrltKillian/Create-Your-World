/** Gradient sky dome: zenith colour above, horizon colour (= fog colour) at and below the horizon. */

export const skyVertex = /* glsl */ `
out vec3 vDirection;

void main() {
  vDirection = normalize(position);
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Push the dome to the far plane so it never hides geometry.
  gl_Position = clip.xyww;
}
`;

export const skyFragment = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
in vec3 vDirection;

void main() {
  float h = clamp(vDirection.y, 0.0, 1.0);
  vec3 color = mix(uHorizon, uZenith, pow(h, 0.6));
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;
