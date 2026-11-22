/**
 * Packed chunk vertex: two 32-bit words (read in GLSL as `uvec2`).
 *
 * w0: x, y, z in 1/16 block (10 bits each, 0–512) | AO or UV corner (2 bits)
 * w1: layer (9) | face (3) | sky light sum (6) | block light sum (6) | tint (5) | flags (3)
 */

export const VERTEX_WORDS = 2;
export const QUAD_WORDS = VERTEX_WORDS * 4;

export function packW0(x16: number, y16: number, z16: number, ao: number): number {
  return (x16 | (y16 << 10) | (z16 << 20) | ((ao & 3) << 30)) >>> 0;
}

export function packW1(
  layer: number,
  face: number,
  sky: number,
  block: number,
  tint: number,
  flags: number,
): number {
  return (
    ((layer & 511) |
      ((face & 7) << 9) |
      ((sky & 63) << 12) |
      ((block & 63) << 18) |
      ((tint & 31) << 24) |
      ((flags & 7) << 29)) >>>
    0
  );
}

export interface UnpackedVertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly ao: number;
  readonly layer: number;
  readonly face: number;
  readonly sky: number;
  readonly block: number;
  readonly tint: number;
  readonly flags: number;
}

/** Decodes a vertex (tests and debugging only). Positions are returned in blocks. */
export function unpackVertex(w0: number, w1: number): UnpackedVertex {
  return {
    x: (w0 & 1023) / 16,
    y: ((w0 >>> 10) & 1023) / 16,
    z: ((w0 >>> 20) & 1023) / 16,
    ao: (w0 >>> 30) & 3,
    layer: w1 & 511,
    face: (w1 >>> 9) & 7,
    sky: (w1 >>> 12) & 63,
    block: (w1 >>> 18) & 63,
    tint: (w1 >>> 24) & 31,
    flags: (w1 >>> 29) & 7,
  };
}
