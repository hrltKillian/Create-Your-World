import { hash32 } from '../../../../core/hash.ts';
import { LETTERS } from '../palette.ts';

/*
 * The creatures' pixel art (plan v5 « M52 »): each face of a box painted texel by texel in the
 * palette's letters (palette.ts LETTERS: five tones a material, `#` the ink, `W` a glint), by
 * small rules a pixel artist follows: a base tone lit along the top and shaded along the bottom,
 * scattered strokes of fur, scales, feathers or plates, bands of another colour with a ragged
 * edge, and features stamped by hand (eyes, nostrils, claws). Pure and deterministic: the grain
 * comes from a hash of the texel.
 */

/** A texel's letter: material `m` (its index in the creature's materials) at tone 1–5. */
export function tone(m: number, t: number): string {
  return LETTERS[m]![Math.max(1, Math.min(5, Math.round(t))) - 1]!;
}

/** The material and tone of a letter (undefined for the ink and glints). */
function toneOf(ch: string): [number, number] | undefined {
  for (let m = 0; m < LETTERS.length; m++) {
    const t = LETTERS[m]!.indexOf(ch);
    if (t >= 0) return [m, t + 1];
  }
  return undefined;
}

/** The same material `d` tones lighter (negative: darker). */
export function shade(ch: string, d: number): string {
  const at = toneOf(ch);
  return at ? tone(at[0], at[1] + d) : ch;
}

/** A hash of a texel in [0, 1). */
export function noise(x: number, y: number, seed: number): number {
  return hash32(x, y, seed) / 4294967296;
}

/** A face's texels, rows from the top. */
export class Face {
  readonly w: number;
  readonly h: number;
  private readonly px: string[];

  constructor(w: number, h: number, fill = '.') {
    this.w = w;
    this.h = h;
    this.px = new Array<string>(w * h).fill(fill);
  }

  get(x: number, y: number): string {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x]! : '.';
  }

  set(x: number, y: number, ch: string): this {
    if (ch !== '.' && ch !== ' ' && x >= 0 && y >= 0 && x < this.w && y < this.h)
      this.px[y * this.w + x] = ch;
    return this;
  }

  /** Rows of letters drawn at (x, y); spaces and dots leave the face as it is. */
  stamp(x: number, y: number, rows: readonly string[]): this {
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) this.set(x + dx, y + dy, row[dx]!);
    });
    return this;
  }

  /** Fills the rectangle [x0, x1) × [y0, y1). */
  rect(x0: number, y0: number, x1: number, y1: number, ch: string): this {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, ch);
    return this;
  }

  /** Shades the texel `d` tones. */
  shade(x: number, y: number, d: number): this {
    return this.set(x, y, shade(this.get(x, y), d));
  }

  /** Darkens the texels along the named edges (l, r, t, b): the box turns away there. */
  edges(sides: string, d = -1): this {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (
          (sides.includes('l') && x === 0) ||
          (sides.includes('r') && x === this.w - 1) ||
          (sides.includes('t') && y === 0) ||
          (sides.includes('b') && y === this.h - 1)
        )
          this.shade(x, y, d);
    return this;
  }

  /** Mirrored left to right (a box's left side from its right). */
  flip(): Face {
    const out = new Face(this.w, this.h);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) out.set(this.w - 1 - x, y, this.get(x, y));
    return out;
  }
}

/** The surface textures a coat may have. */
export type Grain = 'fur' | 'shag' | 'scale' | 'feather' | 'speckle' | 'smooth';

export interface CoatOptions {
  /** Base tone (1–5), and how many rows are lit at the top and shaded at the bottom. */
  readonly base?: number;
  readonly top?: number;
  readonly bottom?: number;
  readonly grain?: Grain;
  readonly seed?: number;
}

/**
 * A face of material `m`: its base tone, lit rows along the top and shaded rows along the bottom
 * (their border dithered), and its grain: scattered strokes of fur, long shaggy locks, scales in
 * staggered rows, feathers, specks, or nearly plain.
 */
export function coat(w: number, h: number, m: number, options: CoatOptions = {}): Face {
  const { base = 3, top = 1, bottom = 1, grain = 'speckle', seed = 0 } = options;
  const face = new Face(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let t = base;
      if (y < top || (y === top && noise(x, y, seed + 1) < 0.5)) t += 1;
      if (y >= h - bottom || (y === h - bottom - 1 && noise(x, y, seed + 2) < 0.5)) t -= 1;
      t += grainAt(grain, x, y, seed);
      face.set(x, y, tone(m, t));
    }
  }
  return face;
}

/** The tone shift of a grain at a texel. */
function grainAt(grain: Grain, x: number, y: number, seed: number): number {
  const r = noise(x, y, seed);
  switch (grain) {
    case 'fur':
      // Strokes of two or three texels down the face, darker or lighter, scattered.
      for (let back = 0; back < 3; back++) {
        if (y - back < 0) break;
        const long = back < 2 || noise(x, y - back, seed + 50) < 0.5;
        if (long && noise(x, y - back, seed + 40) < 0.1) return -1;
        if (long && noise(x, y - back, seed + 41) < 0.07) return 1;
      }
      return 0;
    case 'shag': {
      // Long locks: each column a run of five, lit at its root and dark at its tip.
      const run = (y + Math.floor(noise(x, 0, seed) * 5)) % 5;
      let t = run === 0 && r < 0.7 ? 1 : run >= 3 && r < 0.55 ? -1 : 0;
      if (x % 2 === 1 && noise(x >> 1, Math.floor(y / 3), seed + 5) < 0.3) t -= 1;
      return t;
    }
    case 'scale': {
      const ox = Math.floor(y / 2) % 2 ? 2 : 0;
      if ((x + ox) % 4 === 0 && y % 2 === 1) return -1;
      return (x + ox) % 4 === 2 && y % 2 === 0 && r < 0.6 ? 1 : 0;
    }
    case 'feather': {
      const fx = (x + (Math.floor(y / 3) % 2) * 2) % 4;
      if (y % 3 === 2 && fx !== 1) return -1;
      return y % 3 === 0 && fx === 1 ? 1 : 0;
    }
    case 'speckle':
      return r < 0.09 ? -1 : r > 0.93 ? 1 : 0;
    default:
      return r < 0.04 ? -1 : 0;
  }
}

/** A painter of a plain face: material `m` at `base`, a faint grain. */
export function plain(m: number, base: number, seed = 0) {
  return (w: number, h: number) =>
    coat(w, h, m, { base, top: 0, bottom: 0, grain: 'smooth', seed });
}

/**
 * Repaints rows y0…y1 (exclusive) in material `m` at `base` (a pale belly, a dark band), their
 * upper edge ragged, the bottom row a tone darker.
 */
export function band(face: Face, m: number, y0: number, y1: number, base: number, seed = 0): Face {
  for (let x = 0; x < face.w; x++) {
    const start = y0 + (noise(x, y0, seed) < 0.3 ? 1 : 0) - (noise(x, y0, seed + 3) < 0.15 ? 1 : 0);
    for (let y = Math.max(0, start); y < Math.min(face.h, y1); y++) {
      const t = base - (noise(x, y, seed + 7) < 0.1 ? 1 : 0) - (y === face.h - 1 ? 1 : 0);
      face.set(x, y, tone(m, t));
    }
  }
  return face;
}

/**
 * Armour scutes over a face of material `m`: plates `cols` × `rows` texels, each row staggered by
 * half a plate, dark seams between them, each plate shaded from its rim to a lit middle through a
 * growth ring.
 */
export function scutes(face: Face, m: number, rows: number, cols: number, seed = 0): Face {
  for (let y = 0; y < face.h; y++) {
    for (let x = 0; x < face.w; x++) {
      const lx = (x + seed + (Math.floor(y / rows) % 2) * (cols >> 1)) % cols;
      const ly = y % rows;
      if (lx === cols - 1 || ly === rows - 1) {
        face.set(x, y, tone(m, 1));
        continue;
      }
      // From the rim in: shadow, the plate, a growth ring, the lit middle.
      const rim = Math.min(lx, cols - 2 - lx, ly, rows - 2 - ly);
      const t = [2, 3, 2][rim] ?? 4;
      face.set(x, y, tone(m, t + (ly === 0 ? 1 : 0) - (noise(x, y, seed) < 0.08 ? 1 : 0)));
    }
  }
  return face;
}

/** Texels inside the ellipse centred on (cx, cy) with radii rx, ry. */
export function inEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}
