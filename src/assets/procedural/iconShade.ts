/**
 * Icons as modelled sprites (plan v4 « M42 », decision 30): an icon's flat colour regions (one a
 * palette index) are shaded as rounded volumes, lit from the top left, with a glint where they
 * face the light. Pure: the same mask always gives the same bytes.
 */

/** Light from the top left, a little in front (x right, y up, z out of the icon). */
const LIGHT = [-0.55, 0.55, 0.63] as const;
/** Half-way vector of the light and the eye (straight out): where the glint is. */
const HALF = (() => {
  const v = [LIGHT[0], LIGHT[1], LIGHT[2] + 1];
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l] as const;
})();
/** How steep the volumes' edges get, how dark their far side and how bright the glint. */
const SLOPE = 2.2;
const SHADE_FROM = 0.72;
const SHADE_RANGE = 0.5;
const GLINT = 0.38;

/**
 * Shades the colours (RGBA, rows bottom-up, `size` square) of an icon whose texels belong to
 * `regions` (a palette index each, −1 for a hole), in place. A region rounds off over `size / 10`
 * texels from its edges.
 */
export function shadeIcon(color: Uint8Array, regions: Int16Array, size: number): void {
  const heights = new Float32Array(size * size);
  const reach = Math.max(1, Math.round(size / 10));
  // Distance (in texels, up to `reach`) to the nearest texel of another region or a hole.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const region = regions[i]!;
      if (region < 0) continue;
      let d = reach;
      for (let dy = -reach; dy <= reach && d > 0; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          const other =
            nx < 0 || ny < 0 || nx >= size || ny >= size || regions[ny * size + nx] !== region;
          if (other) d = Math.min(d, Math.max(Math.abs(dx), Math.abs(dy)) - 0.5);
        }
      }
      const t = Math.max(0, d) / reach;
      heights[i] = t * (2 - t);
    }
  }
  const at = (x: number, y: number, region: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return 0;
    const i = y * size + x;
    return regions[i] === region ? heights[i]! : 0;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const region = regions[i]!;
      if (region < 0) continue;
      const gx = (at(x - 1, y, region) - at(x + 1, y, region)) * SLOPE;
      const gy = (at(x, y - 1, region) - at(x, y + 1, region)) * SLOPE;
      const length = Math.hypot(gx, gy, 1);
      const nx = gx / length;
      const ny = gy / length;
      const nz = 1 / length;
      const lit = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
      const shade = SHADE_FROM + SHADE_RANGE * lit;
      const facing = Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]);
      const glint = GLINT * facing ** 24 * 255;
      const o = i * 4;
      for (let k = 0; k < 3; k++)
        color[o + k] = Math.min(255, Math.max(0, Math.round(color[o + k]! * shade + glint)));
    }
  }
}
