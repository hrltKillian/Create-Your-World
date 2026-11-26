import { unit } from './texNoise.ts';

/**
 * What a texture pattern returns for one texel (plan v4 « M36 »): a palette tone, a pixel class
 * and a relief height. Rows are bottom-up (y = 0 is the bottom row).
 */

export const SOLID = 0;
/** Transparent in coverage textures (leaves, glass, plants). */
export const HOLE = 1;
/** Mask pixels: ore flecks, glowing embers, the grass part of a turf side. */
export const SPECIAL = 2;

export interface Pixel {
  /** Palette position, fractional between two colours (`writeTone`). */
  tone: number;
  kind: number;
  /** Relief height 0…1; NaN: from the tone (darker is deeper). */
  height: number;
}

/** What a pattern knows of its texture. */
export interface PatternContext {
  readonly seed: number;
  readonly size: number;
  /** Colours of the main ramp: the palette without its accents. */
  readonly n: number;
  /** Accent colours after the ramp (berries, fruit), drawn as spots by the patterns that take them. */
  readonly accents: number;
  /** size / 16: feature sizes are given for a 16-texel tile. */
  readonly s: number;
}

export type PatternFn = (ctx: PatternContext, x: number, y: number) => Pixel;

const px: Pixel = { tone: 0, kind: SOLID, height: Number.NaN };

/** The shared pixel, set (patterns return it; read it before the next call). */
export function set(tone: number, kind = SOLID, height = Number.NaN): Pixel {
  px.tone = tone;
  px.kind = kind;
  px.height = height;
  return px;
}

/** The tone at `v` (0…1) along `count` colours from `from`. */
export function ramp(v: number, from: number, count: number): number {
  return from + unit(v) * Math.max(0, count - 1);
}
