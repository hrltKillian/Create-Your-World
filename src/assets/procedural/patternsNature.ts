import { hash32, hashUnit } from '../../core/hash.ts';
import {
  cellular,
  fbm,
  grain,
  smooth,
  stretch,
  tri,
  unit,
  valueNoise,
  wrapDelta,
} from './texNoise.ts';
import { HOLE, type PatternContext, type Pixel, ramp, SOLID, SPECIAL, set } from './texPixel.ts';

/**
 * Natural texture patterns (plan v4 « M36 »): grounds, rock, liquids, plants. Each draws a tone
 * along its palette ramp and a relief height; feature sizes are in 16-texel units (`ctx.s`).
 */

/** Mottling: fur, skins, worn cloth. */
export function speckle(c: PatternContext, x: number, y: number): Pixel {
  const v = stretch(0.6 * fbm(c.seed, x, y, c.size, 4, 3) + 0.4 * grain(c.seed, x, y), 1.5);
  return set(ramp(v, 0, c.n));
}

/** Fur and plumes: fine strands running down the hide, in soft clumps, paler at the tips. */
export function fur(c: PatternContext, x: number, y: number): Pixel {
  const { seed, size } = c;
  const strands = valueNoise(seed, x, y, size, 16, 3);
  const clump = fbm(seed + 1, x, y, size, 4, 2);
  const g = grain(seed, x, y);
  const v = 0.2 + 0.45 * strands + 0.25 * clump + 0.15 * (g - 0.5);
  return set(ramp(v, 0, c.n), SOLID, 0.3 + 0.5 * strands + 0.2 * clump);
}

/** Rock over `count` colours: broad mottling, fine grain, open hairline cracks and pits. */
function rock(c: PatternContext, x: number, y: number, count: number): Pixel {
  const { seed, size } = c;
  const base = fbm(seed, x, y, size, 3, 4);
  const detail = fbm(seed + 1, x, y, size, 8, 2);
  const g = grain(seed, x, y);
  const v = stretch(0.65 * base + 0.35 * detail, 2.2) * 0.85 + g * 0.15;
  const h = 0.3 + 0.5 * base + 0.2 * detail;
  // A crack follows the mid contour of a third noise where a fourth one opens it.
  const vein = fbm(seed + 2, x, y, size, 3, 2);
  if (Math.abs(vein - 0.5) < 0.8 / size && valueNoise(seed + 3, x, y, size, 3) > 0.55)
    return set(ramp(v * 0.4, 0, count), SOLID, 0.1);
  if (g > 0.965) return set(ramp(v * 0.6, 0, count), SOLID, h - 0.25);
  return set(ramp(v, 0, count), SOLID, h);
}

export function stone(c: PatternContext, x: number, y: number): Pixel {
  return rock(c, x, y, c.n);
}

/** Rounded pebbles of their own shades with grit between them. */
export function gravel(c: PatternContext, x: number, y: number): Pixel {
  const cell = cellular(c.seed, x, y, c.size, 6);
  const edge = cell.f2 - cell.f1;
  const g = grain(c.seed, x, y);
  if (edge < 0.1) return set(ramp(g * 0.3, 0, c.n), SOLID, 0.05);
  // Lit from the top left: the offset from the pebble's centre shades it.
  const v = 0.15 + 0.7 * hashUnit(cell.id, 1) + (cell.dy - cell.dx) * 0.3 + (g - 0.5) * 0.2;
  return set(ramp(v, 0, c.n), SOLID, 0.2 + 0.8 * smooth(unit(edge * 2.5)));
}

/** Fine grain over wind ripples (sand, snow). */
export function sand(c: PatternContext, x: number, y: number): Pixel {
  const { seed, size } = c;
  const drift = fbm(seed, x, y, size, 2, 2);
  // (x + 3y) / size × 2 moves by whole periods across the tile: the ripples tile.
  const wave = tri(((x + 3 * y) / size) * 2 + drift * 1.5);
  const g = grain(seed, x, y);
  const v = 0.3 + 0.3 * wave + 0.25 * fbm(seed + 1, x, y, size, 8, 2) + 0.4 * (g - 0.5);
  return set(ramp(v, 0, c.n), SOLID, 0.3 + 0.5 * wave + 0.2 * g);
}

/** Soil over `count` colours: clumps and a few pale pebbles. */
function ground(c: PatternContext, x: number, y: number, count: number): Pixel {
  const { seed, size } = c;
  const pebble = cellular(seed + 3, x, y, size, 6);
  if (pebble.f1 < 0.24 && hashUnit(pebble.id, 4) < 0.3) {
    const dome = 1 - pebble.f1 / 0.24;
    const v = 0.55 + 0.35 * dome + (pebble.dy - pebble.dx) * 0.3;
    return set(ramp(v, 0, count), SOLID, 0.6 + 0.4 * dome);
  }
  const clump = fbm(seed, x, y, size, 4, 3);
  const g = grain(seed, x, y);
  const v =
    stretch(0.7 * clump + 0.3 * fbm(seed + 1, x, y, size, 12, 1), 2.4) * 0.75 + (g - 0.5) * 0.35;
  return set(ramp(v, 0, count), SOLID, 0.2 + 0.5 * clump + 0.1 * g);
}

export function soil(c: PatternContext, x: number, y: number): Pixel {
  return ground(c, x, y, c.n);
}

/** Grass seen from above: clumps, bright blade tips and dark gaps. */
export function turf(c: PatternContext, x: number, y: number): Pixel {
  const { seed, size } = c;
  const tip = hashUnit(seed, x, y, 9);
  if (tip < 0.05) return set(0, SOLID, 0.1);
  const clump = fbm(seed, x, y, size, 4, 2);
  const g = grain(seed, x, y);
  const bright = tip > 0.88 ? 0.3 : 0;
  return set(
    ramp(stretch(0.5 * clump + 0.35 * g + bright, 1.3), 0, c.n),
    SOLID,
    0.3 + 0.5 * g + bright,
  );
}

/** Layered rock: bands of their own shade and height, broken seams between them. */
export function strata(c: PatternContext, x: number, y: number): Pixel {
  const { seed, size, s } = c;
  const bands = Math.max(2, Math.round(size / (3 * s)));
  const wobble = (valueNoise(seed, x, 0, size, 3, 1) - 0.5) * 3 * s;
  const yy = (((y + wobble) % size) + size) % size;
  const band = Math.floor((yy * bands) / size);
  const into = (yy * bands) / size - band;
  const g = grain(seed, x, y);
  const v = 0.55 * hashUnit(seed, band, 3) + 0.3 * fbm(seed + 1, x, y, size, 6, 2) + 0.15 * g;
  if ((into * size) / bands < 1 && valueNoise(seed + 2, x, y, size, 4) > 0.4)
    return set(ramp(v * 0.4, 0, c.n), SOLID, 0.1);
  return set(ramp(v, 0, c.n), SOLID, 0.35 + 0.35 * hashUnit(seed, band, 5) + 0.3 * v);
}

/** Wavy water, ice, a shell's growth lines. */
export function ripple(c: PatternContext, x: number, y: number): Pixel {
  const { seed, size } = c;
  const wave = tri((y / size) * 4 + fbm(seed, x, y, size, 3, 3) * 2);
  const v = 0.6 * wave + 0.4 * fbm(seed + 1, x, y, size, 8, 2);
  return set(ramp(v, 0, c.n), SOLID, 0.3 + 0.6 * wave);
}

/** Molten blobs (SPECIAL, the last three colours) under a darker, higher crust. */
export function sludge(c: PatternContext, x: number, y: number): Pixel {
  const crust = Math.max(1, c.n - 3);
  const v = 0.88 * fbm(c.seed, x, y, c.size, 4, 3) + 0.12 * grain(c.seed, x, y);
  if (v > 0.47) {
    const t = (v - 0.47) / 0.53;
    return set(ramp(stretch(t, 1.6), crust, c.n - crust), SPECIAL, 0.35 - 0.2 * t);
  }
  const t = v / 0.47;
  return set(ramp(t, 0, crust), SOLID, 0.5 + 0.4 * t);
}

/** Glowing shards (SPECIAL, the last two colours) in rock, lit on their left facet. */
export function crystal(c: PatternContext, x: number, y: number): Pixel {
  const rockCount = Math.max(1, c.n - 2);
  for (let i = 0; i < 3; i++) {
    const dx = wrapDelta(x, hash32(c.seed, i, 17) % c.size, c.size);
    const dy = wrapDelta(y, hash32(c.seed, i, 19) % c.size, c.size);
    const d = (2 * Math.abs(dx) + Math.abs(dy)) / c.s;
    if (d <= 4.5) {
      const t = d <= 1.2 ? 1 : 1 - d / 4.5 + (dx < 0 ? 0.25 : 0);
      return set(ramp(t, rockCount, c.n - rockCount), SPECIAL, 0.6 + 0.4 * (1 - d / 4.5));
    }
  }
  return rock(c, x, y, rockCount);
}

/** Ore flecks (SPECIAL, the last two colours): irregular raised clusters in rock. */
export function ore(c: PatternContext, x: number, y: number): Pixel {
  const { seed, size, s } = c;
  const rockCount = Math.max(1, c.n - 2);
  const wobble = (valueNoise(seed + 5, x, y, size, 8) - 0.5) * 1.6 * s;
  for (let i = 0; i < 4; i++) {
    const dx = wrapDelta(x, hash32(seed, i, 11) % size, size);
    const dy = wrapDelta(y, hash32(seed, i, 13) % size, size);
    const r = (1.1 + 0.9 * hashUnit(seed, i, 15)) * s;
    const d = Math.sqrt(dx * dx + dy * dy) + wobble;
    if (d < r) {
      const t = 1 - d / r;
      const v = 0.7 * t + 0.3 * grain(seed, x, y) + (dy - dx) / (4 * r);
      return set(ramp(v, rockCount, c.n - rockCount), SPECIAL, 0.7 + 0.3 * t);
    }
  }
  return rock(c, x, y, rockCount);
}

/** An accent spot (berries, fruit) over `cells` cells, or null: whole accent colours, domed. */
function accentSpot(c: PatternContext, x: number, y: number, cells: number): Pixel | null {
  if (c.accents === 0) return null;
  const spot = cellular(c.seed + 9, x, y, c.size, cells);
  if (spot.f1 >= 0.2 || hashUnit(spot.id, 4) >= 0.45) return null;
  const accent = c.n + Math.floor(hashUnit(spot.id, 6) * c.accents);
  return set(accent, SOLID, 1 - (spot.f1 / 0.2) * 0.6);
}

/** Overlapping leaves with a mid rib, shaded from the top left, holes between them. */
export function leaves(c: PatternContext, x: number, y: number): Pixel {
  const spot = accentSpot(c, x, y, 5);
  if (spot) return spot;
  const leaf = cellular(c.seed, x, y, c.size, 7);
  const a = (hashUnit(leaf.id, 2) - 0.5) * 0.9;
  const e = Math.sqrt(leaf.dx * leaf.dx * (1 + a) + leaf.dy * leaf.dy * (1 - a));
  const r = 0.5 + 0.2 * hashUnit(leaf.id, 3);
  if (e > r) return set(0, HOLE);
  // The rib runs along the long axis: y when the leaf is narrow in x (a > 0).
  const rib = Math.abs(a > 0 ? leaf.dx : leaf.dy) < 0.05 ? 0.15 : 0;
  const gap = leaf.f2 - leaf.f1 < 0.08 ? 0.25 : 0;
  const v =
    0.25 +
    0.5 * hashUnit(leaf.id, 1) +
    (leaf.dy - leaf.dx) * 0.35 -
    rib -
    gap +
    (grain(c.seed, x, y) - 0.5) * 0.15;
  const t = e / r;
  return set(ramp(v, 0, c.n), SOLID, (1 - t * t) * (gap > 0 ? 0.5 : 1));
}

/** Blades rising from the bottom, tapering and leaning, darker at the foot (plants). */
export function cross(c: PatternContext, x: number, y: number): Pixel {
  const { seed, size } = c;
  const blades = size >> 1;
  for (let b = 0; b < blades; b++) {
    const top = size * (0.4 + 0.6 * hashUnit(seed, b, 3));
    if (y >= top) continue;
    const t = y / top;
    const centre = 1 + hashUnit(seed, b, 1) * (size - 2) + (hashUnit(seed, b, 2) - 0.5) * 0.25 * y;
    const half = (0.5 + 0.6 * (1 - t)) * c.s * 0.6;
    const d = Math.abs(x + 0.5 - centre);
    if (d < half) {
      const v = 0.1 + 0.85 * t + (hashUnit(seed, b, 4) - 0.5) * 0.3;
      return set(ramp(v, 0, c.n), SOLID, 1 - d / half);
    }
  }
  return set(0, HOLE);
}

/**
 * Flames (plan v5 « M47 », a fire block's cross quads): tongues rising from the whole width, each
 * its own height, hottest (the last colours) low in their middle, darkest (0) at their tips.
 */
export function flame(c: PatternContext, x: number, y: number): Pixel {
  const { seed, size } = c;
  // Tongues: their heights across, from a tileable noise; their edges waver as they rise.
  const xx = x + (valueNoise(seed + 5, x, y, size, 2, 4) - 0.5) * 0.25 * y;
  const top = size * (0.35 + 0.6 * valueNoise(seed, xx, 0, size, 5, 1));
  if (y >= top) return set(0, HOLE);
  const t = y / top;
  const core = 1 - Math.abs((((xx / size) * 5) % 1) - 0.5) * 2;
  const heat = (1 - t) * (0.55 + 0.45 * core) + (grain(seed, x, y) - 0.5) * 0.15;
  return set(ramp(heat, 0, c.n), SOLID, 1 - t);
}

/** Bark: ridged plates split by deep wavering fissures along the trunk, a few cross cracks. */
export function bark(c: PatternContext, x: number, y: number): Pixel {
  const spot = accentSpot(c, x, y, 4);
  if (spot) return spot;
  const { seed, size, s } = c;
  // Fissures run up the trunk: a noise across x alone, read at an x that wavers with y.
  const xx = x + (valueNoise(seed + 3, x, y, size, 3, 6) - 0.5) * 2 * s;
  const ridge = valueNoise(seed, xx, 0, size, 12, 1);
  const g = grain(seed, x, y);
  if (ridge < 0.25) {
    const t = ridge / 0.25;
    return set(ramp(0.2 * t + 0.1 * g, 0, c.n), SOLID, 0.3 * t);
  }
  if (valueNoise(seed + 4, x, y, size, 12, 4) < 0.14)
    return set(ramp(0.15 * g, 0, c.n), SOLID, 0.15);
  const streak = valueNoise(seed + 2, x, y, size, 16, 3);
  const v = 0.3 + 0.3 * streak + 0.35 * unit((ridge - 0.25) * 2) + 0.2 * (g - 0.5);
  return set(ramp(v, 0, c.n), SOLID, 0.45 + 0.45 * unit((ridge - 0.25) * 3) + 0.1 * streak);
}

/** A log's end: growth rings in the wood (colours 1…), the bark round them (colour 0). */
export function rings(c: PatternContext, x: number, y: number): Pixel {
  const { seed, size, s } = c;
  const mid = (size - 1) / 2;
  const dx = x - mid;
  const dy = y - mid;
  const d = Math.sqrt(dx * dx + dy * dy) + (valueNoise(seed, x, y, size, 4) - 0.5) * 1.5 * s;
  if (d > mid - 0.4 * s) return set(0, SOLID, 0.45);
  const ring = tri(d / (1.6 * s));
  const v = 0.2 + 0.55 * ring + 0.25 * (grain(seed, x, y) - 0.5);
  return set(ramp(v, 1, c.n - 1), SOLID, 0.55 + 0.15 * ring);
}

/** A turf block's side: soil, under a ragged band of grass (SPECIAL, the last two colours). */
export function turfSide(c: PatternContext, x: number, y: number): Pixel {
  const { seed, size, s } = c;
  const soilCount = Math.max(1, c.n - 2);
  const depth = (2.5 + 2.5 * valueNoise(seed, x, 0, size, 6, 1) + 1.2 * hashUnit(seed, x, 5)) * s;
  const from = size - depth;
  if (y >= from) {
    const v = 0.25 + 0.45 * grain(seed, x, y) + ((y - from) / depth) * 0.3;
    return set(ramp(v, soilCount, c.n - soilCount), SPECIAL, 0.75 + 0.25 * grain(seed + 1, x, y));
  }
  return ground(c, x, y, soilCount);
}
