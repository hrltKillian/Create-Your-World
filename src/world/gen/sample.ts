import { pickBiome } from './biomes.ts';
import { type ClimateSample, emptySample, interpolateSample } from './climate.ts';
import type { GenContext } from './generateColumn.ts';
import { coarseHeight, surfaceHeight } from './terrain.ts';

/*
 * Analytic queries: the climate, surface height and biome of any block column, without generating
 * anything. Bulk generation goes through the same functions, so both always agree.
 */

/** Lattice samples reused within one generation call (keyed by lattice coordinates). */
export class LatticeCache {
  private readonly samples = new Map<number, ClimateSample>();

  get(ctx: GenContext, lx: number, lz: number): ClimateSample {
    const key = (lx + 0x100000) * 0x200000 + (lz + 0x100000);
    let sample = this.samples.get(key);
    if (!sample) {
      sample = emptySample();
      ctx.climate.raw(lx * ctx.def.climateStep, lz * ctx.def.climateStep, sample);
      this.samples.set(key, sample);
    }
    return sample;
  }
}

/** Climate at a block position, interpolated from the world-anchored lattice. */
export function sampleAt(
  ctx: GenContext,
  cache: LatticeCache,
  x: number,
  z: number,
  out: ClimateSample,
): void {
  const step = ctx.def.climateStep;
  const lx = Math.floor(x / step);
  const lz = Math.floor(z / step);
  const tx = (x - lx * step) / step;
  const tz = (z - lz * step) / step;
  // On a lattice line the far corners get a zero weight: reusing the near ones gives exactly the
  // same values, and sparse queries (biome and structure searches) sample 1 point instead of 4.
  const s00 = cache.get(ctx, lx, lz);
  const s10 = tx === 0 ? s00 : cache.get(ctx, lx + 1, lz);
  const s01 = tz === 0 ? s00 : cache.get(ctx, lx, lz + 1);
  const s11 = tz === 0 ? s10 : tx === 0 ? s01 : cache.get(ctx, lx + 1, lz + 1);
  interpolateSample(s00, s10, s01, s11, tx, tz, out);
}

const scratch = emptySample();

/** Surface height (y of the top terrain block) at a block column; `out` gets its climate. */
export function heightAt(
  ctx: GenContext,
  cache: LatticeCache,
  x: number,
  z: number,
  out: ClimateSample = scratch,
): number {
  sampleAt(ctx, cache, x, z, out);
  return surfaceHeight(out, ctx.def);
}

/** The biome a column's own climate sample picks, before lone columns are settled. */
export function rawBiomeOf(ctx: GenContext, sample: ClimateSample, x: number, z: number): number {
  const border = ctx.def.biomeBorder;
  const shift = ctx.border(x / border.scale, z / border.scale) * border.amplitude;
  return pickBiome(ctx.biomeDefs, sample, coarseHeight(sample, ctx.def), shift);
}

function rawBiome(ctx: GenContext, cache: LatticeCache, x: number, z: number): number {
  sampleAt(ctx, cache, x, z, scratch);
  return rawBiomeOf(ctx, scratch, x, z);
}

/**
 * Biome index (in `ctx.biomes`) of a block column. Its climate picks a biome (height rules read
 * the terrain without its small detail, `coarseHeight`, and every threshold is shifted by the
 * smooth border field), then a column whose biome none of its 4 neighbours shares (the tip of a
 * corner where two thresholds cross) takes the biome most of them have (the first in order on a
 * tie): borders are clean lines, never single columns.
 */
export function biomeOf(ctx: GenContext, cache: LatticeCache, x: number, z: number): number {
  const own = rawBiome(ctx, cache, x, z);
  // Neighbours are read only until one shares the column's biome (most columns: the first).
  const w = rawBiome(ctx, cache, x - 1, z);
  if (own === w) return own;
  const e = rawBiome(ctx, cache, x + 1, z);
  if (own === e) return own;
  const n = rawBiome(ctx, cache, x, z - 1);
  if (own === n) return own;
  return settledBiome(own, w, e, n, rawBiome(ctx, cache, x, z + 1));
}

/**
 * A column's biome from its raw biome and its 4 neighbours' (`biomeOf`'s rule, for callers that
 * hold the raw biomes of a grid): its own when a neighbour shares it, else the most common.
 */
export function settledBiome(own: number, w: number, e: number, n: number, s: number): number {
  if (own === w || own === e || own === n || own === s) return own;
  return majority(majority(majority(w, e, w, e, n, s), n, w, e, n, s), s, w, e, n, s);
}

/** Of two candidate biomes, the one more of w, e, n, s have (the first in order on a tie). */
function majority(a: number, b: number, w: number, e: number, n: number, s: number): number {
  const ca = (a === w ? 1 : 0) + (a === e ? 1 : 0) + (a === n ? 1 : 0) + (a === s ? 1 : 0);
  const cb = (b === w ? 1 : 0) + (b === e ? 1 : 0) + (b === n ? 1 : 0) + (b === s ? 1 : 0);
  return cb > ca || (cb === ca && b < a) ? b : a;
}

export interface PointInfo {
  readonly height: number;
  readonly biome: number;
}

/** Surface height and biome of one block column, without generating anything. */
export function pointInfo(
  ctx: GenContext,
  x: number,
  z: number,
  cache = new LatticeCache(),
): PointInfo {
  return { height: heightAt(ctx, cache, x, z), biome: biomeOf(ctx, cache, x, z) };
}
