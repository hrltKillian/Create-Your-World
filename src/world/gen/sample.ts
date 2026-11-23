import { hashUnit } from '../../core/hash.ts';
import { pickBiome } from './biomes.ts';
import { type ClimateSample, emptySample, interpolateSample } from './climate.ts';
import type { GenContext } from './generateColumn.ts';
import { surfaceHeight } from './terrain.ts';

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
  interpolateSample(
    cache.get(ctx, lx, lz),
    cache.get(ctx, lx + 1, lz),
    cache.get(ctx, lx, lz + 1),
    cache.get(ctx, lx + 1, lz + 1),
    tx,
    tz,
    out,
  );
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

/** Biome index (in `ctx.biomes`) of a block column, from its climate sample and height. */
export function biomeOf(
  ctx: GenContext,
  sample: ClimateSample,
  height: number,
  x: number,
  z: number,
): number {
  const jitter = (hashUnit(ctx.seedHash, x, z, 77) - 0.5) * 2 * ctx.def.biomeJitter;
  return pickBiome(ctx.biomeDefs, sample, height, jitter);
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
  const sample = emptySample();
  const height = heightAt(ctx, cache, x, z, sample);
  return { height, biome: biomeOf(ctx, sample, height, x, z) };
}
