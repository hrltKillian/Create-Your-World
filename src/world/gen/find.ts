import { emptySample } from './climate.ts';
import type { GenContext } from './generateColumn.ts';
import { biomeOf, heightAt, LatticeCache } from './sample.ts';
import { REGION, regionOf, siteIn } from './structures.ts';

/*
 * Analytic searches over the generated world (nothing is generated): the nearest column of a
 * biome, the nearest structure of a kind, and whether biomes lie within a distance (spawn rule).
 */

/** Biome searches sample every BIOME_STEP blocks (a multiple of the climate lattice step). */
export const BIOME_STEP = 16;

export interface Place {
  readonly x: number;
  readonly z: number;
}

export interface FoundBiome extends Place {
  /** Distance from the search origin, in blocks. */
  readonly distance: number;
}

export interface FoundStructure extends FoundBiome {
  /** Ground layer of the structure (its bottom template layer). */
  readonly y: number;
}

/**
 * Visits a square spiral, ring by ring out to `rings` (offsets in grid steps; ring 0 is the
 * centre), until `visit` returns true. Returns whether it stopped early.
 */
export function spiral(
  rings: number,
  visit: (dx: number, dz: number, ring: number) => boolean,
): boolean {
  if (visit(0, 0, 0)) return true;
  for (let r = 1; r <= rings; r++) {
    for (let i = -r; i <= r; i++) if (visit(i, -r, r) || visit(i, r, r)) return true;
    for (let i = 1 - r; i < r; i++) if (visit(-r, i, r) || visit(r, i, r)) return true;
  }
  return false;
}

/** Index of a biome key in `ctx.biomes` (throws for an unknown key). */
export function biomeIndexOf(ctx: GenContext, key: string): number {
  const index = ctx.biomes.findIndex((b) => b.def.key === key);
  if (index < 0) throw new Error(`Unknown biome "${key}"`);
  return index;
}

const sample = emptySample();

function biomeAt(ctx: GenContext, cache: LatticeCache, x: number, z: number): number {
  const h = heightAt(ctx, cache, x, z, sample);
  return biomeOf(ctx, sample, h, x, z);
}

/**
 * Samples biomes every BIOME_STEP blocks within `maxRadius` of `from`, ring by ring outwards,
 * until `visit` returns true. `visit` gets the biome, the point and its distance.
 */
function scanBiomes(
  ctx: GenContext,
  cache: LatticeCache,
  from: Place,
  maxRadius: number,
  visit: (biome: number, x: number, z: number, distance: number, ring: number) => boolean,
): void {
  const ox = Math.round(from.x / BIOME_STEP);
  const oz = Math.round(from.z / BIOME_STEP);
  spiral(Math.ceil(maxRadius / BIOME_STEP) + 1, (dx, dz, ring) => {
    const x = (ox + dx) * BIOME_STEP;
    const z = (oz + dz) * BIOME_STEP;
    const distance = Math.sqrt((x - from.x) * (x - from.x) + (z - from.z) * (z - from.z));
    if (distance > maxRadius) return false;
    return visit(biomeAt(ctx, cache, x, z), x, z, distance, ring);
  });
}

/** The nearest sampled column of a biome within `maxRadius` blocks of `from`, or null. */
export function findBiome(
  ctx: GenContext,
  biomeKey: string,
  from: Place,
  maxRadius: number,
): FoundBiome | null {
  const wanted = biomeIndexOf(ctx, biomeKey);
  let best = null as FoundBiome | null;
  scanBiomes(ctx, new LatticeCache(), from, maxRadius, (biome, x, z, distance, ring) => {
    // Points of ring r lie at least (r − 1) steps away: no later ring can beat the best hit.
    if (best && (ring - 1) * BIOME_STEP > best.distance) return true;
    if (biome === wanted && (!best || distance < best.distance)) best = { x, z, distance };
    return false;
  });
  return best;
}

/** Whether every biome of `wanted` (indices) has a sampled column within `maxRadius` of `from`. */
export function biomesWithin(
  ctx: GenContext,
  cache: LatticeCache,
  from: Place,
  maxRadius: number,
  wanted: readonly number[],
): boolean {
  const missing = new Set(wanted);
  if (missing.size === 0) return true;
  scanBiomes(ctx, cache, from, maxRadius, (biome) => missing.delete(biome) && missing.size === 0);
  return missing.size === 0;
}

/** The nearest structure of a kind (its key) within `maxRadius` blocks of `from`, or null. */
export function findStructure(
  ctx: GenContext,
  structureKey: string,
  from: Place,
  maxRadius: number,
): FoundStructure | null {
  if (!ctx.structures.some((s) => s.key === structureKey))
    throw new Error(`Unknown structure "${structureKey}"`);
  const cache = new LatticeCache();
  const reach = Math.ceil(maxRadius / REGION) + 1;
  const rx0 = regionOf(Math.floor(from.x));
  const rz0 = regionOf(Math.floor(from.z));
  let best = null as FoundStructure | null;
  for (let rz = rz0 - reach; rz <= rz0 + reach; rz++) {
    for (let rx = rx0 - reach; rx <= rx0 + reach; rx++) {
      const site = siteIn(ctx, cache, rx, rz);
      if (!site || site.structure.key !== structureKey) continue;
      const x = site.x0 + (site.structure.width >> 1);
      const z = site.z0 + (site.structure.depth >> 1);
      const distance = Math.sqrt((x - from.x) * (x - from.x) + (z - from.z) * (z - from.z));
      if (distance <= maxRadius && (!best || distance < best.distance))
        best = { x, y: site.y, z, distance };
    }
  }
  return best;
}
