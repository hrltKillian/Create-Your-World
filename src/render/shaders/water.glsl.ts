/**
 * Liquids in the chunk shader (plan v4 « M38 »): which texture layers are liquids (`uLiquidLayers`,
 * liquidLayers.ts), the slope of the water's surface (travelling waves, rain rings) and the
 * caustics the sun throws on surfaces seen from under water. All analytic: no texture fetch.
 */
export const WATER = /* glsl */ `
uniform int uLiquidLayers[16];
/** 1 while the camera is in a liquid (caustics), else 0. */
uniform float uUnderwater;

bool liquidLayer(float layer) {
  int l = int(layer + 0.5);
  return ((uLiquidLayers[l >> 5] >> (l & 31)) & 1) != 0;
}

// A hash without sine (the same on every GPU).
float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// The slope of one travelling wave: amplitude a, direction d, wave number k, speed w.
vec2 wave(vec2 p, float t, vec2 d, float k, float w, float a) {
  return d * (a * k * cos(k * dot(d, p) - w * t));
}

// Rings spreading from raindrops, one drop a cell, each at its own moment.
vec2 rainRings(vec2 p, float t) {
  vec2 cell = floor(p * 1.5);
  vec2 local = fract(p * 1.5) - 0.5 - (vec2(hash12(cell), hash12(cell + 7.7)) - 0.5) * 0.5;
  float age = fract(t * 0.9 + hash12(cell + 3.1));
  float r = length(local) + 1e-4;
  float ring = cos((r - age * 0.6) * 40.0) * (1.0 - age) * smoothstep(0.5, 0.0, r);
  return local / r * ring * 0.25;
}

// The water surface's slope (d height / d x, d height / d z) at a point of the world.
vec2 waterSlope(vec2 p, float t, float rain) {
  vec2 s = wave(p, t, vec2(0.8, 0.6), 1.3, 1.6, 0.05)
    + wave(p, t, vec2(-0.6, 0.8), 2.1, 2.2, 0.03)
    + wave(p, t, vec2(0.96, -0.28), 3.7, 3.1, 0.015)
    + wave(p, t, vec2(-0.2, -0.98), 6.3, 4.3, 0.008);
  return rain > 0.0 ? s + rain * rainRings(p, t) : s;
}

// Bright wavering lines of light on the bottom, as a rippled surface focuses the sun.
float caustic(vec2 p, float t) {
  vec2 q = p * 0.9;
  float c = sin(q.x * 2.1 + t * 1.3 + sin(q.y * 1.7 - t))
    + sin(q.y * 2.3 - t * 1.1 + sin(q.x * 1.9 + t * 0.7));
  return pow(clamp(1.0 - abs(c) * 0.6, 0.0, 1.0), 6.0);
}
`;
