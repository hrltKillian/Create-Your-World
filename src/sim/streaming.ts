/** Column offsets sorted by distance (then angle-free tie-break), precomputed up to radius 16. */
export const MAX_STREAM_RADIUS = 16;

export const SPIRAL: readonly (readonly [number, number])[] = (() => {
  const out: [number, number, number][] = [];
  for (let dz = -MAX_STREAM_RADIUS; dz <= MAX_STREAM_RADIUS; dz++) {
    for (let dx = -MAX_STREAM_RADIUS; dx <= MAX_STREAM_RADIUS; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 <= MAX_STREAM_RADIUS * MAX_STREAM_RADIUS) out.push([dx, dz, d2]);
    }
  }
  out.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  return out.map(([dx, dz]) => [dx, dz] as const);
})();

/**
 * Radii derived from the render distance RD (in columns). The margins are 1.5 and 2.5 rather than
 * 1 and 2 because the circles are Euclidean: a meshable column on the rim of the RD circle has
 * diagonal neighbours up to √2 further out, and those need their own face neighbours.
 */
export function streamRadii(renderDistance: number): {
  mesh: number;
  light: number;
  generate: number;
  unload: number;
} {
  return {
    mesh: renderDistance,
    light: renderDistance + 1.5,
    generate: renderDistance + 2.5,
    unload: renderDistance + 3.5,
  };
}

export function withinRadius(dx: number, dz: number, radius: number): boolean {
  return dx * dx + dz * dz <= radius * radius;
}
