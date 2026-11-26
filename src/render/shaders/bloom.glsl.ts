/**
 * The bloom passes (plan v4 « M40 », Bloom.ts): a full-screen triangle; the bright parts of the
 * HDR frame halved down a chain of smaller targets, blurred back up into each other, and added to
 * the frame, which is tone mapped and turned to sRGB on the way to the screen.
 */
export const bloomVertex = /* glsl */ `
out vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Halves the source with a 4-tap box; the first pass keeps only what shines over the threshold. */
export const bloomDownFragment = /* glsl */ `
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uThreshold;
in vec2 vUv;

void main() {
  vec3 c = 0.25 * (
    texture(uSource, vUv + uTexel * vec2(-1.0, -1.0)).rgb +
    texture(uSource, vUv + uTexel * vec2(1.0, -1.0)).rgb +
    texture(uSource, vUv + uTexel * vec2(-1.0, 1.0)).rgb +
    texture(uSource, vUv + uTexel * vec2(1.0, 1.0)).rgb);
  if (uThreshold > 0.0) {
    // What shines over the threshold, eased in over a soft knee of half of it.
    float b = max(c.r, max(c.g, c.b));
    float knee = uThreshold * 0.5;
    float soft = clamp(b - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    c *= max(soft, b - uThreshold) / max(b, 1e-4);
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

/** Blurs the smaller target back up (a 9-tap tent), added onto the larger one. */
export const bloomUpFragment = /* glsl */ `
uniform sampler2D uSource;
uniform vec2 uTexel;
in vec2 vUv;

void main() {
  vec3 c = 4.0 * texture(uSource, vUv).rgb;
  c += 2.0 * (
    texture(uSource, vUv + vec2(uTexel.x, 0.0)).rgb +
    texture(uSource, vUv - vec2(uTexel.x, 0.0)).rgb +
    texture(uSource, vUv + vec2(0.0, uTexel.y)).rgb +
    texture(uSource, vUv - vec2(0.0, uTexel.y)).rgb);
  c += texture(uSource, vUv + uTexel).rgb + texture(uSource, vUv - uTexel).rgb;
  c += texture(uSource, vUv + vec2(uTexel.x, -uTexel.y)).rgb;
  c += texture(uSource, vUv + vec2(-uTexel.x, uTexel.y)).rgb;
  gl_FragColor = vec4(c / 16.0, 1.0);
}
`;

/** The frame plus its bloom, tone mapped and turned to sRGB for the screen. */
export const bloomCompositeFragment = /* glsl */ `
uniform sampler2D uFrame;
uniform sampler2D uBloom;
uniform float uStrength;
in vec2 vUv;

void main() {
  vec3 c = texture(uFrame, vUv).rgb + texture(uBloom, vUv).rgb * uStrength;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
