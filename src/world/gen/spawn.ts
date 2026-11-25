import { FLAG_SOLID } from '../../content/registry.ts';
import { Column } from '../Column.ts';
import { columnKey, toColumn, toLocal } from '../coords.ts';
import { topBlockAt } from './banks.ts';
import { caveAt } from './caves.ts';
import { emptySample } from './climate.ts';
import { biomeIndexOf, biomesWithin, spiral } from './find.ts';
import { FLAT_SURFACE } from './flat.ts';
import { type GenContext, generateColumn, isFlatWorld } from './generateColumn.ts';
import { biomeOf, heightAt, LatticeCache } from './sample.ts';
import { nearSite, regionOf, siteIn } from './structures.ts';

export interface SpawnPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Candidates: a spiral over a grid of CANDIDATE_STEP blocks, out to CANDIDATE_RINGS rings. */
const CANDIDATE_STEP = 16;
const CANDIDATE_RINGS = 128;
/** Water and the near blocks are looked for every NEAR_STEP blocks. */
const NEAR_STEP = 2;
/** A spawn keeps this far from a structure's footprint. */
const STRUCTURE_CLEARANCE = 2;

/** Surface of a block column: height, biome index and top terrain block (`topBlockAt`). */
interface Surface {
  height: number;
  biome: number;
  top: number;
}

const sample = emptySample();

/**
 * The surfaces the search visits, each computed once: the `nearRadius` disks of neighbouring
 * candidates overlap, so a point comes back up to about 20 times. A surface is packed in one
 * number, top · 2^16 + biome · 2^8 + height (heights stay within 4–240, biome indices below 256).
 */
class Surfaces {
  readonly cache = new LatticeCache();
  private readonly ctx: GenContext;
  /** Keyed like columns (unique within the world border). */
  private readonly packed = new Map<number, number>();

  constructor(ctx: GenContext) {
    this.ctx = ctx;
  }

  /** The surface at (x, z), written into `out`. */
  read(x: number, z: number, out: Surface): Surface {
    const key = columnKey(x, z);
    let value = this.packed.get(key);
    if (value === undefined) {
      const ctx = this.ctx;
      const height = heightAt(ctx, this.cache, x, z, sample);
      const biome = biomeOf(ctx, this.cache, x, z);
      value = topBlockAt(ctx, x, z, height, ctx.biomes[biome]!) * 65536 + biome * 256 + height;
      this.packed.set(key, value);
    }
    out.height = value & 255;
    out.biome = (value >> 8) & 255;
    out.top = Math.floor(value / 65536);
    return out;
  }
}

/**
 * Spawn point (docs « Point d'apparition »), sampled analytically: spiralling out from the origin,
 * the first dry column of a spawn biome (neither carved nor near a structure) that meets the
 * pack's spawn rules: water and the near blocks within `nearRadius`, the far biomes within
 * `farRadius`. Without rules, or when no column meets them, the first dry column of a spawn biome.
 * Either way the player must fit there between the decoration, checked on the generated column.
 */
export function findSpawn(ctx: GenContext): SpawnPoint {
  if (isFlatWorld(ctx.worldType)) return { x: 0.5, y: FLAT_SURFACE + 1, z: 0.5 };
  const surfaces = new Surfaces(ctx);
  const rule = ctx.def.spawn;
  const near = (rule?.near ?? []).map((key) => ctx.registry.defaultState(key));
  const far = (rule?.far ?? []).map((key) => biomeIndexOf(ctx, key));
  const meetsRules = (x: number, z: number, biome: number) =>
    !rule ||
    (nearby(ctx, surfaces, x, z, biome, near, rule.nearRadius) &&
      biomesWithin(ctx, surfaces.cache, { x, z }, rule.farRadius, far));
  return (
    searchHome(ctx, surfaces, meetsRules) ??
    searchHome(ctx, surfaces, () => true) ?? { x: 0.5, y: ctx.def.seaLevel + 2, z: 0.5 }
  );
}

const home: Surface = { height: 0, biome: 0, top: 0 };

/** The first home column of the candidate spiral that `accept`s, where the player fits, or null. */
function searchHome(
  ctx: GenContext,
  surfaces: Surfaces,
  accept: (x: number, z: number, biome: number) => boolean,
): SpawnPoint | null {
  let found = null as SpawnPoint | null;
  spiral(CANDIDATE_RINGS, (dx, dz) => {
    const x = dx * CANDIDATE_STEP;
    const z = dz * CANDIDATE_STEP;
    surfaces.read(x, z, home);
    if (!isHome(ctx, surfaces.cache, x, z, home) || !accept(x, z, home.biome)) return false;
    if (!awayFromOpenings(ctx, surfaces, x, z)) return false;
    if (!fitsPlayer(ctx, x, home.height + 1, z)) return false;
    found = { x: x + 0.5, y: home.height + 1, z: z + 0.5 };
    return true;
  });
  return found;
}

/** A dry column of a spawn biome, whose surface is not carved, away from structures. */
function isHome(
  ctx: GenContext,
  cache: LatticeCache,
  x: number,
  z: number,
  surface: Surface,
): boolean {
  if (surface.height <= ctx.def.seaLevel) return false;
  if (ctx.spawnBiomes.size > 0 && !ctx.spawnBiomes.has(surface.biome)) return false;
  if (caveAt(ctx, cache, x, surface.height, z)) return false;
  const site = siteIn(ctx, cache, regionOf(x), regionOf(z));
  return !site || !nearSite(site, x, z, STRUCTURE_CLEARANCE);
}

/** No cave entrance or ravine opens the surface within this many blocks of the spawn. */
const OPENING_CLEARANCE = 8;

/** Whether no column within OPENING_CLEARANCE of (x, z) has its surface carved open. */
function awayFromOpenings(ctx: GenContext, surfaces: Surfaces, x: number, z: number): boolean {
  const r = OPENING_CLEARANCE;
  for (let dz = -r; dz <= r; dz++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r * r) continue;
      surfaces.read(x + dx, z + dz, point);
      if (caveAt(ctx, surfaces.cache, x + dx, point.height, z + dz)) return false;
    }
  return true;
}

/**
 * Whether the player fits with its feet at (x, y, z): solid ground, and no trunk, boulder or
 * canopy in the feet and head cells. The column is generated (a few milliseconds, only for the
 * columns that pass every other test), so decoration is exactly what the world will hold.
 */
function fitsPlayer(ctx: GenContext, x: number, y: number, z: number): boolean {
  const column = new Column(toColumn(x), toColumn(z), ctx.registry.air);
  generateColumn(ctx, column);
  const flags = ctx.registry.tables.flags;
  const solid = (at: number) =>
    (flags[column.getBlock(toLocal(x), at, toLocal(z))]! & FLAG_SOLID) !== 0;
  return solid(y - 1) && !solid(y) && !solid(y + 1);
}

const point: Surface = { height: 0, biome: 0, top: 0 };

/**
 * Whether the home biome's liquid and every `near` block lie on the surface within `radius`
 * blocks of (x, z).
 */
function nearby(
  ctx: GenContext,
  surfaces: Surfaces,
  x: number,
  z: number,
  homeBiome: number,
  near: readonly number[],
  radius: number,
): boolean {
  const liquid = ctx.biomes[homeBiome]!.liquid;
  const missing = new Set(near);
  let water = false;
  spiral(Math.ceil(radius / NEAR_STEP), (dx, dz) => {
    const px = x + dx * NEAR_STEP;
    const pz = z + dz * NEAR_STEP;
    if ((px - x) * (px - x) + (pz - z) * (pz - z) > radius * radius) return false;
    surfaces.read(px, pz, point);
    if (point.height < ctx.def.seaLevel && ctx.biomes[point.biome]!.liquid === liquid) water = true;
    missing.delete(point.top);
    return water && missing.size === 0;
  });
  return water && missing.size === 0;
}
