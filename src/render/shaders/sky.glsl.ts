/**
 * The sky's colour along a direction: the palette's horizon at and below the horizon, its zenith
 * above, and the haze round the sun along the horizon (strongest at dawn and dusk). Shared by the
 * sky dome, the water's reflection (plan v4 « M38 ») and the fog (« M39 »: the far land melts into
 * the sky behind it). `sun` points towards the sun.
 */
export const SKY_GRADIENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;

vec3 skyGradient(vec3 dir) {
  return mix(uHorizon, uZenith, pow(clamp(dir.y, 0.0, 1.0), 0.6));
}

vec3 skyHaze(vec3 dir, vec3 sun) {
  vec2 d = normalize(dir.xz + 1e-5);
  vec2 s = normalize(sun.xz + 1e-5);
  float toward = pow(max(dot(d, s), 0.0), 4.0);
  return uHaze * toward * (1.0 - clamp(dir.y * 3.0, 0.0, 1.0));
}
`;

/**
 * The sky dome (plan v4 « M39 »): the gradient and haze, a round sun with its halo, one or two
 * moons lit by the sun (their phases), a ringed giant and nebulae among stars that turn and
 * twinkle, a layer of clouds and the auroras' curtains. Directions are unit vectors in world
 * space; the dome follows the camera.
 */
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
uniform vec3 uSunColor;
uniform float uSunCos;
uniform vec3 uMoonDir[2];
uniform vec3 uMoonColor[2];
uniform float uMoonCos[2];
uniform vec3 uGiantDir;
uniform float uGiantCos;
uniform vec3 uGiantColor;
uniform vec3 uGiantBands;
uniform vec3 uGiantRing;
uniform vec3 uNebula[2];
uniform vec3 uAuroraColor[2];
uniform float uStars;
uniform vec2 uStarTurn;
uniform float uCloud;
uniform vec3 uCloudLight;
uniform float uAurora;
uniform float uTime;
in vec3 vDirection;

// Stars: one candidate per cell of a grid this many cells across the sky's radius.
const float STAR_GRID = 150.0;
const float STAR_CHANCE = 0.994;
// Clouds: the layer's height scale and its drift (sky units a second).
const vec2 WIND = vec2(0.012, 0.005);

// Hashes without sine (the same on every GPU).
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
    mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm2(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * noise2(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x);
  float b = mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x);
  float c = mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x);
  float d = mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x);
  return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}

// 1 inside the disc around 'center', with an edge about one pixel wide.
float disc(vec3 dir, vec3 center, float cosRadius) {
  float d = dot(dir, center);
  float w = max(fwidth(d), 1e-5);
  return smoothstep(cosRadius - w, cosRadius + w, d);
}

// A sphere seen as a disc of radius acos(cosRadius) around 'center': its normal under 'dir'.
vec3 sphereNormal(vec3 dir, vec3 center, float cosRadius) {
  vec3 q = (dir - center * dot(dir, center)) / sqrt(1.0 - cosRadius * cosRadius);
  return normalize(q - center * sqrt(max(0.0, 1.0 - dot(q, q))));
}

// A moon lit by the sun from where the sun stands: its phase, and a faint ashen light.
vec3 moon(vec3 dir, int i) {
  vec3 n = sphereNormal(dir, uMoonDir[i], uMoonCos[i]);
  float lit = max(dot(n, uSunDir), 0.0);
  float mottle = 0.85 + 0.15 * noise3(n * 6.0 + float(i) * 9.0);
  return uMoonColor[i] * (lit * mottle + 0.04);
}

// The giant: banded, lit by the sun, its ring across it (in front below its middle, behind above).
vec4 giant(vec3 dir) {
  vec3 c = uGiantDir;
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), c) + vec3(1e-5));
  vec3 north = cross(c, east);
  float r = sqrt(1.0 - uGiantCos * uGiantCos);
  // The disc's own coordinates, tilted a little: x along the ring, y across it (radii).
  vec2 p = vec2(dot(dir, east), dot(dir, north)) / r;
  p = mat2(0.94, -0.34, 0.34, 0.94) * p;
  float body = disc(dir, c, uGiantCos);
  vec3 n = sphereNormal(dir, c, uGiantCos);
  float bands = 0.5 + 0.5 * sin(p.y * 9.0 + noise3(n * 3.0) * 2.5);
  // Its night side keeps a faint glow (the light of its own moons), its rim a thin haze.
  float rim = pow(1.0 - max(dot(-n, c), 0.0), 3.0);
  vec3 surface = mix(uGiantColor, uGiantBands, bands) * (max(dot(n, uSunDir), 0.0) * 0.85 + 0.22);
  surface += uGiantRing * rim * 0.35;
  float e = length(vec2(p.x, p.y / 0.22));
  // Only on the giant's side of the sky: the antipode projects to the same coordinates.
  float ring = smoothstep(1.35, 1.4, e) * (1.0 - smoothstep(1.85, 1.9, e)) * step(0.0, dot(dir, c));
  ring *= 0.6 + 0.4 * sin(e * 40.0);
  float hidden = body * step(0.0, p.y);
  vec3 ringColor = uGiantRing * (0.25 + 0.75 * max(uSunDir.y + 0.3, 0.0));
  vec3 color = mix(surface, ringColor, ring * (1.0 - hidden));
  return vec4(color, max(body, ring * (1.0 - hidden) * 0.8));
}

// Curtains of light hanging over the horizon, waving slowly.
vec3 aurora(vec3 dir) {
  float h = dir.y;
  float band = smoothstep(0.06, 0.18, h) * (1.0 - smoothstep(0.3, 0.75, h));
  if (band <= 0.0) return vec3(0.0);
  float az = atan(dir.x, -dir.z);
  float folds = noise2(vec2(az * 3.0 + uTime * 0.05, uTime * 0.03));
  float rays = noise2(vec2(az * 40.0 + folds * 6.0, uTime * 0.2));
  float glow = band * pow(folds, 2.0) * (0.4 + 0.6 * rays);
  return mix(uAuroraColor[0], uAuroraColor[1], smoothstep(0.1, 0.55, h)) * glow * 1.2;
}

void main() {
  vec3 dir = normalize(vDirection);
  vec3 color = skyGradient(dir) + skyHaze(dir, uSunDir);
  // Sun, moons, the giant and stars only above the horizon (the ground hides the rest).
  float above = smoothstep(-0.02, 0.02, dir.y);
  // The direction in the stars' own frame, which turns about z with the sun.
  vec3 s = vec3(
    uStarTurn.x * dir.x + uStarTurn.y * dir.y,
    uStarTurn.x * dir.y - uStarTurn.y * dir.x,
    dir.z
  );

  if (uStars > 0.0) {
    float n = noise3(s * 2.2) * 0.6 + noise3(s * 5.1) * 0.4;
    float cloud = smoothstep(0.5, 0.9, n);
    color += mix(uNebula[0], uNebula[1], noise3(s * 1.3 + 4.0)) * cloud * uStars * above * 0.4;
    vec3 grid = s * STAR_GRID;
    vec3 cell = floor(grid);
    float pick = hash13(cell);
    if (pick > STAR_CHANCE) {
      vec3 jitter = vec3(hash13(cell + 7.1), hash13(cell + 3.7), hash13(cell + 1.3)) - 0.5;
      float star = 1.0 - smoothstep(0.05, 0.2, length(grid - cell - 0.5 - jitter * 0.6));
      float brightness = 0.35 + 0.65 * fract(pick * 251.0);
      float twinkle = 0.75 + 0.25 * sin(uTime * 3.0 + pick * 400.0);
      // Warm and cold stars.
      vec3 tint = mix(vec3(1.0, 0.85, 0.7), vec3(0.75, 0.85, 1.0), fract(pick * 97.0));
      color += tint * (star * brightness * twinkle * uStars * above);
    }
  }

  vec4 g = uGiantCos < 1.0 ? giant(dir) : vec4(0.0);
  // By day the giant fades into the blue, as a moon does.
  color = mix(color, g.rgb, g.a * above * (0.35 + 0.65 * max(uStars, 0.2)));

  float sunAlign = max(dot(dir, uSunDir), 0.0);
  color += uSunColor * (0.3 * pow(sunAlign, 48.0) * above);
  color = mix(color, uSunColor * 1.2, disc(dir, uSunDir, uSunCos) * above);
  for (int i = 0; i < 2; i++) {
    float d = disc(dir, uMoonDir[i], uMoonCos[i]) * above;
    if (d > 0.0) color = mix(color, moon(dir, i), d);
  }

  if (uAurora > 0.0) color += aurora(dir) * uAurora;

  // Clouds: a layer seen from below, thicker with the weather, lit by the sky's light.
  if (dir.y > 0.01) {
    vec2 p = dir.xz / (dir.y + 0.08) * 0.6 + uTime * WIND;
    float cover = mix(0.3, 0.9, uCloud);
    float d = smoothstep(1.0 - cover, 1.0 - cover + 0.3, fbm2(p * 1.5));
    vec3 lit = uCloudLight * (1.0 + 0.6 * pow(sunAlign, 6.0));
    float fade = smoothstep(0.01, 0.18, dir.y);
    color = mix(color, mix(lit, lit * 0.4, uCloud), d * fade);
  }

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;
