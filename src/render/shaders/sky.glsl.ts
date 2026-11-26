/**
 * Sky dome: palette gradient (zenith above, horizon = fog colour at and below the horizon), a round
 * sun and a round moon (discs measured by angle, so they stay round at any view), and stars that
 * turn with them. Directions are unit vectors in world space; the dome follows the camera.
 */

/**
 * The sky's colour along a direction: the palette's horizon below and at the horizon, its zenith
 * above. Shared by the sky dome and the water's reflection (plan v4 « M38 »).
 */
export const SKY_GRADIENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;

vec3 skyGradient(vec3 dir) {
  return mix(uHorizon, uZenith, pow(clamp(dir.y, 0.0, 1.0), 0.6));
}
`;

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
${SKY_GRADIENT}
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uStars;
uniform vec2 uStarTurn;
in vec3 vDirection;

// Cosines of the discs' angular radii (sun about 3°, moon about 2.5°).
const float SUN_COS = 0.9986;
const float MOON_COS = 0.9990;
const vec3 SUN_COLOR = vec3(1.0, 0.92, 0.72);
const vec3 MOON_COLOR = vec3(0.74, 0.79, 0.9);
// Stars: one candidate per cell of a grid this many cells across the sky's radius.
const float STAR_GRID = 150.0;
const float STAR_CHANCE = 0.996;

// Hash without sine (the same on every GPU).
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// 1 inside the disc around 'center', with an edge about one pixel wide.
float disc(vec3 dir, vec3 center, float cosRadius) {
  float d = dot(dir, center);
  float w = max(fwidth(d), 1e-5);
  return smoothstep(cosRadius - w, cosRadius + w, d);
}

void main() {
  vec3 dir = normalize(vDirection);
  vec3 color = skyGradient(dir);
  // Sun, moon and stars only above the horizon (the ground hides the rest).
  float above = smoothstep(-0.02, 0.02, dir.y);

  if (uStars > 0.0) {
    // The direction in the sky's own frame, which turns about z with the sun.
    vec3 s = vec3(
      uStarTurn.x * dir.x + uStarTurn.y * dir.y,
      uStarTurn.x * dir.y - uStarTurn.y * dir.x,
      dir.z
    ) * STAR_GRID;
    vec3 cell = floor(s);
    float pick = hash13(cell);
    if (pick > STAR_CHANCE) {
      vec3 jitter = vec3(hash13(cell + 7.1), hash13(cell + 3.7), hash13(cell + 1.3)) - 0.5;
      float star = 1.0 - smoothstep(0.05, 0.2, length(s - cell - 0.5 - jitter * 0.6));
      float brightness = 0.35 + 0.65 * fract(pick * 251.0);
      color += vec3(star * brightness * uStars * above);
    }
  }

  float sunAlign = max(dot(dir, uSunDir), 0.0);
  color += SUN_COLOR * (0.3 * pow(sunAlign, 48.0) * above);
  color = mix(color, SUN_COLOR * 1.2, disc(dir, uSunDir, SUN_COS) * above);
  color = mix(color, MOON_COLOR, disc(dir, uMoonDir, MOON_COS) * above);

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;
