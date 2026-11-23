import { topBlockAt } from './banks.ts';
import { caveAt } from './caves.ts';
import { biomeIndexOf, biomesWithin, spiral } from './find.ts';
import { FLAT_SURFACE } from './flat.ts';
import { type GenContext, isFlatWorld } from './generateColumn.ts';
import { LatticeCache, type PointInfo, pointInfo } from './sample.ts';
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

/**
 * Spawn point (docs « Point d'apparition »), sampled analytically: spiralling out from the origin,
 * the first dry column of a spawn biome (neither carved nor near a structure) that meets the
 * pack's spawn rules: water and the near blocks within `nearRadius`, the far biomes within
 * `farRadius`. Without rules, or when no column meets them, the first dry column of a spawn biome.
 */
export function findSpawn(ctx: GenContext): SpawnPoint {
  if (isFlatWorld(ctx.worldType)) return { x: 0.5, y: FLAT_SURFACE + 1, z: 0.5 };
  const cache = new LatticeCache();
  const rule = ctx.def.spawn;
  const near = (rule?.near ?? []).map((key) => ctx.registry.defaultState(key));
  const far = (rule?.far ?? []).map((key) => biomeIndexOf(ctx, key));
  let first = null as SpawnPoint | null;
  let found = null as SpawnPoint | null;
  spiral(CANDIDATE_RINGS, (dx, dz) => {
    const x = dx * CANDIDATE_STEP;
    const z = dz * CANDIDATE_STEP;
    const info = pointInfo(ctx, x, z, cache);
    if (!isHome(ctx, cache, x, z, info)) return false;
    const point = { x: x + 0.5, y: info.height + 1, z: z + 0.5 };
    first ??= point;
    if (
      rule &&
      !(
        nearby(ctx, cache, x, z, info.biome, near, rule.nearRadius) &&
        biomesWithin(ctx, cache, { x, z }, rule.farRadius, far)
      )
    )
      return false;
    found = point;
    return true;
  });
  return found ?? first ?? { x: 0.5, y: ctx.def.seaLevel + 2, z: 0.5 };
}

/** A dry column of a spawn biome, whose surface is not carved, away from structures. */
function isHome(
  ctx: GenContext,
  cache: LatticeCache,
  x: number,
  z: number,
  info: PointInfo,
): boolean {
  if (info.height <= ctx.def.seaLevel) return false;
  if (ctx.spawnBiomes.size > 0 && !ctx.spawnBiomes.has(info.biome)) return false;
  if (caveAt(ctx, cache, x, info.height, z)) return false;
  const site = siteIn(ctx, cache, regionOf(x), regionOf(z));
  return !site || !nearSite(site, x, z, STRUCTURE_CLEARANCE);
}

/**
 * Whether the home biome's liquid and every `near` block lie on the surface within `radius`
 * blocks of (x, z).
 */
function nearby(
  ctx: GenContext,
  cache: LatticeCache,
  x: number,
  z: number,
  home: number,
  near: readonly number[],
  radius: number,
): boolean {
  const liquid = ctx.biomes[home]!.liquid;
  const missing = new Set(near);
  let water = false;
  spiral(Math.ceil(radius / NEAR_STEP), (dx, dz) => {
    const px = x + dx * NEAR_STEP;
    const pz = z + dz * NEAR_STEP;
    if ((px - x) * (px - x) + (pz - z) * (pz - z) > radius * radius) return false;
    const info = pointInfo(ctx, px, pz, cache);
    const biome = ctx.biomes[info.biome]!;
    if (info.height < ctx.def.seaLevel && biome.liquid === liquid) water = true;
    missing.delete(topBlockAt(ctx, px, pz, info.height, biome));
    return water && missing.size === 0;
  });
  return water && missing.size === 0;
}
