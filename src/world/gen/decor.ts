import { FLAG_REPLACEABLE } from '../../content/registry.ts';
import type { FeatureKind } from '../../content/schema.ts';
import { hash32, hashUnit } from '../../core/hash.ts';
import type { Column } from '../Column.ts';
import { columnIndex, localIndex, SECTION_SIZE, WORLD_HEIGHT } from '../coords.ts';
import { bankAt } from './banks.ts';
import { caveAt, heightIndex } from './caves.ts';
import { emptySample } from './climate.ts';
import type { GenContext, ResolvedBiome } from './generateColumn.ts';
import { biomeOf, heightAt, type LatticeCache } from './sample.ts';
import { nearSite, type StructureSite } from './structures.ts';

/*
 * Decoration (docs « Génération » step 7): plants per surface block, and features (trees, giant
 * mushrooms, boulders, columns, patches) with at most one candidate per 8×8 cell, its chances
 * scaled by the biome's sub-zones (`groves`: clearings and dense groves, plan v3 « M23 »). A
 * candidate is a pure function of the seed, the surface height, the biome, the banks and the caves
 * at its centre. Every column replays the candidates around it in a fixed order and writes only its own
 * voxels, so the result does not depend on the order in which columns are generated.
 */

/** A feature of the pack with block states resolved. */
export interface ResolvedFeature {
  readonly kind: FeatureKind;
  readonly block: number;
  /** Canopy or cap, −1 for the other kinds. */
  readonly crown: number;
  readonly size0: number;
  readonly size1: number;
  readonly soil: ReadonlySet<number>;
  /** 2: a giant's 2×2 trunk and wider crown. */
  readonly trunk: number;
}

/** Side of a candidate cell, and how far a feature reaches from its centre. */
const CELL = 8;
const REACH = 7;

function getLocal(column: Column, lx: number, y: number, lz: number): number {
  return column.sections[y >> 5]!.getBlock(localIndex(lx, y & 31, lz));
}

function isFree(ctx: GenContext, state: number): boolean {
  return state === ctx.registry.air || (ctx.registry.tables.flags[state]! & FLAG_REPLACEABLE) !== 0;
}

/**
 * Writes a voxel at world coordinates if it belongs to the column; `onlyFree` keeps anything that
 * is neither air nor replaceable (canopies do not cut trunks, boulders do not bury plants' soil).
 */
function put(
  ctx: GenContext,
  column: Column,
  x: number,
  y: number,
  z: number,
  state: number,
  onlyFree: boolean,
): void {
  const lx = x - column.cx * SECTION_SIZE;
  const lz = z - column.cz * SECTION_SIZE;
  if (lx < 0 || lz < 0 || lx >= SECTION_SIZE || lz >= SECTION_SIZE || y <= 0 || y >= WORLD_HEIGHT)
    return;
  const section = column.sections[y >> 5]!;
  const index = localIndex(lx, y & 31, lz);
  if (onlyFree && !isFree(ctx, section.getBlock(index))) return;
  section.setBlock(index, state);
}

/** Plants on the bare surface of dry columns (one draw per block, the chances add up). */
export function placePlants(ctx: GenContext, column: Column, heights: Int16Array): void {
  const x0 = column.cx * SECTION_SIZE;
  const z0 = column.cz * SECTION_SIZE;
  for (let lz = 0; lz < SECTION_SIZE; lz++) {
    for (let lx = 0; lx < SECTION_SIZE; lx++) {
      const h = heights[heightIndex(lx, lz)]!;
      if (h < ctx.def.seaLevel || h + 1 >= WORLD_HEIGHT) continue;
      const biome = ctx.biomes[column.biomes[columnIndex(lx, lz)]!]!;
      if (biome.plants.length === 0 || getLocal(column, lx, h, lz) !== biome.surface) continue;
      let u = hashUnit(ctx.seedHash, x0 + lx, z0 + lz, 9);
      for (const plant of biome.plants) {
        if (u < plant.chance) {
          column.sections[(h + 1) >> 5]!.setBlock(localIndex(lx, (h + 1) & 31, lz), plant.state);
          break;
        }
        u -= plant.chance;
      }
    }
  }
}

/** Smoothstep of t in [0, 1]. */
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * The biome's sub-zone factor at a point: 1 + contrast × n, n a value noise in −1…1 of lattice
 * `scale` (hashed corners, smoothed bilinear blend), never below 0.
 */
function groveFactor(ctx: GenContext, biome: ResolvedBiome, x: number, z: number): number {
  const groves = biome.def.groves;
  if (!groves) return 1;
  const gx = x / groves.scale;
  const gz = z / groves.scale;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const tx = smooth(gx - ix);
  const tz = smooth(gz - iz);
  const at = (dx: number, dz: number) => hashUnit(ctx.seedHash, ix + dx, iz + dz, 61);
  const top = at(0, 0) + (at(1, 0) - at(0, 0)) * tx;
  const bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * tx;
  const n = 2 * (top + (bottom - top) * tz) - 1;
  return Math.max(0, 1 + groves.contrast * n);
}

/** The feature a candidate cell draws (`u` in [0, 1), the chances × `factor`), or null. */
function pickFeature(biome: ResolvedBiome, u: number, factor: number): ResolvedFeature | null {
  if (factor <= 0) return null;
  let rest = u / factor;
  for (const option of biome.features) {
    if (rest < option.chance) return option.feature;
    rest -= option.chance;
  }
  return null;
}

const sample = emptySample();

/**
 * Features whose candidate lies within reach of the column (its 3×3 neighbourhood), except near
 * the structures the column deals with (`sites`): none reaches into their footprints.
 */
export function placeFeatures(
  ctx: GenContext,
  column: Column,
  heights: Int16Array,
  cache: LatticeCache,
  sites: readonly StructureSite[],
): void {
  const x0 = column.cx * SECTION_SIZE;
  const z0 = column.cz * SECTION_SIZE;
  const cellMinX = Math.floor((x0 - REACH) / CELL);
  const cellMaxX = Math.floor((x0 + SECTION_SIZE - 1 + REACH) / CELL);
  const cellMinZ = Math.floor((z0 - REACH) / CELL);
  const cellMaxZ = Math.floor((z0 + SECTION_SIZE - 1 + REACH) / CELL);
  for (let cz = cellMinZ; cz <= cellMaxZ; cz++) {
    for (let cx = cellMinX; cx <= cellMaxX; cx++) {
      const roll = hash32(ctx.seedHash, cx, cz, 21);
      const px = cx * CELL + (roll & 7);
      const pz = cz * CELL + ((roll >>> 3) & 7);
      if (px + REACH < x0 || px - REACH >= x0 + SECTION_SIZE) continue;
      if (pz + REACH < z0 || pz - REACH >= z0 + SECTION_SIZE) continue;
      if (sites.some((site) => nearSite(site, px, pz, REACH))) continue;
      const h = heightAt(ctx, cache, px, pz, sample);
      if (h < ctx.def.seaLevel || h + 1 >= WORLD_HEIGHT) continue;
      const biome = ctx.biomes[biomeOf(ctx, cache, px, pz)]!;
      const factor = groveFactor(ctx, biome, px, pz);
      const feature = pickFeature(biome, hashUnit(ctx.seedHash, cx, cz, 5), factor);
      if (feature === null) continue;
      const bank = bankAt(ctx, px, pz, h);
      if (!feature.soil.has(bank >= 0 ? bank : biome.surface)) continue;
      // An entrance may have carved the ground away.
      if (caveAt(ctx, cache, px, h, pz)) continue;
      const size = feature.size0 + ((roll >>> 6) % (feature.size1 - feature.size0 + 1));
      writeFeature(ctx, column, heights, feature, px, h, pz, size, roll >>> 28);
    }
  }
}

/** Writes the column's part of one feature standing on the surface block (x, h, z). */
function writeFeature(
  ctx: GenContext,
  column: Column,
  heights: Int16Array,
  feature: ResolvedFeature,
  x: number,
  h: number,
  z: number,
  size: number,
  bits: number,
): void {
  switch (feature.kind) {
    case 'broadleaf':
      writeBroadleaf(ctx, column, feature, x, h + size, z);
      break;
    case 'conifer':
      writeConifer(ctx, column, feature, x, h + size, z, size);
      break;
    case 'willow':
      writeWillow(ctx, column, feature, x, h + size, z);
      break;
    case 'mushroom':
      writeCap(ctx, column, feature, x, h + size, z, 2 + (bits & 1));
      break;
    case 'column':
      break;
    case 'boulder':
      writeBoulder(ctx, column, heights, feature, x, h, z, size);
      return;
    case 'patch':
      writePatch(ctx, column, heights, feature, x, z, size);
      return;
  }
  // Trunks, stems and columns last: they replace anything (a neighbour's canopy, plants). A
  // giant's trunk is 2×2, towards +x and +z.
  for (let dz = 0; dz < feature.trunk; dz++)
    for (let dx = 0; dx < feature.trunk; dx++)
      for (let y = h + 1; y <= h + size; y++)
        put(ctx, column, x + dx, y, z + dz, feature.block, false);
}

/**
 * Broadleaf canopy around the trunk top: radius 2 on three layers, then a radius 1 cap; a giant's
 * is two wider (radius 4 on five layers, then 3).
 */
function writeBroadleaf(
  ctx: GenContext,
  column: Column,
  feature: ResolvedFeature,
  x: number,
  top: number,
  z: number,
): void {
  const wide = 2 * (feature.trunk - 1);
  for (let dy = -2 - wide; dy <= 1; dy++) {
    const radius = (dy === 1 ? 1 : 2) + wide;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
        if (corner && hash32(ctx.seedHash, x + dx, top + dy, z + dz) % 3 !== 0) continue;
        // A giant's crown is round: every leaf within the leaves' decay radius of its trunk.
        if (Math.abs(dx) + Math.abs(dz) > radius + 2) continue;
        put(ctx, column, x + dx, top + dy, z + dz, feature.crown, true);
      }
    }
  }
}

/** Conifer: stacked rings that shrink towards the tip (a giant's up to radius 5, not 3). */
function writeConifer(
  ctx: GenContext,
  column: Column,
  feature: ResolvedFeature,
  x: number,
  top: number,
  z: number,
  height: number,
): void {
  for (let dy = -height + 3; dy <= 1; dy++) {
    const fromTop = 1 - dy;
    const radius =
      fromTop <= 1
        ? 0
        : Math.min(1 + 2 * feature.trunk, 1 + ((fromTop - 1) >> 1) - (fromTop % 2 === 0 ? 1 : 0));
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > radius + 1) continue;
        put(ctx, column, x + dx, top + dy, z + dz, feature.crown, true);
      }
    }
  }
}

/**
 * Willow: a dome of radius 3 over the trunk top and radius 2 above it, with strands hanging from
 * about half of its rim cells, 2 to 4 blocks down.
 */
function writeWillow(
  ctx: GenContext,
  column: Column,
  feature: ResolvedFeature,
  x: number,
  top: number,
  z: number,
): void {
  for (let dy = 0; dy <= 1; dy++) {
    const radius = 3 - dy;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const d = dx * dx + dz * dz;
        if (d > radius * radius + 1) continue;
        put(ctx, column, x + dx, top + dy, z + dz, feature.crown, true);
        if (dy !== 0 || d < (radius - 1) * (radius - 1) + 1) continue;
        const roll = hash32(ctx.seedHash, x + dx, top, z + dz);
        if ((roll & 1) === 0) continue;
        const length = 2 + ((roll >>> 1) % 3);
        for (let s = 1; s <= length; s++)
          put(ctx, column, x + dx, top - s, z + dz, feature.crown, true);
      }
    }
  }
}

/** Giant mushroom cap: a drooping rim at the stem top, a disc above it and a smaller one on top. */
function writeCap(
  ctx: GenContext,
  column: Column,
  feature: ResolvedFeature,
  x: number,
  top: number,
  z: number,
  radius: number,
): void {
  for (let dy = 0; dy <= 2; dy++) {
    const r = dy === 2 ? radius - 1 : radius;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const edge = Math.max(Math.abs(dx), Math.abs(dz));
        if (Math.abs(dx) === r && Math.abs(dz) === r) continue;
        if (dy === 0 && edge < r) continue;
        put(ctx, column, x + dx, top + dy, z + dz, feature.crown, true);
      }
    }
  }
}

/**
 * Boulder: a mound of radius `radius`, sunk one block into the ground at (x, h, z). Each of its
 * columns is filled down to the local ground, except where that ground lies more than one block
 * below the centre's: on a slope a boulder never stands on a pillar.
 */
function writeBoulder(
  ctx: GenContext,
  column: Column,
  heights: Int16Array,
  feature: ResolvedFeature,
  x: number,
  h: number,
  z: number,
  radius: number,
): void {
  const reach = radius * radius + 1;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const lx = x + dx - column.cx * SECTION_SIZE;
      const lz = z + dz - column.cz * SECTION_SIZE;
      if (lx < 0 || lz < 0 || lx >= SECTION_SIZE || lz >= SECTION_SIZE) continue;
      const flat = dx * dx + dz * dz;
      if (flat > reach) continue;
      const ground = heights[heightIndex(lx, lz)]!;
      if (ground < h - 1) continue;
      let rise = 0;
      while (flat + (rise + 1) * (rise + 1) <= reach) rise++;
      for (let y = ground + 1; y <= h + rise; y++)
        put(ctx, column, x + dx, y, z + dz, feature.block, true);
    }
  }
}

/** Patch: the block on about half of the soil cells within `radius` of the centre. */
function writePatch(
  ctx: GenContext,
  column: Column,
  heights: Int16Array,
  feature: ResolvedFeature,
  x: number,
  z: number,
  radius: number,
): void {
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz > radius * radius) continue;
      const lx = x + dx - column.cx * SECTION_SIZE;
      const lz = z + dz - column.cz * SECTION_SIZE;
      if (lx < 0 || lz < 0 || lx >= SECTION_SIZE || lz >= SECTION_SIZE) continue;
      if ((hash32(ctx.seedHash, x + dx, z + dz, 43) & 1) === 0) continue;
      const ground = heights[heightIndex(lx, lz)]!;
      if (ground + 1 >= WORLD_HEIGHT || !feature.soil.has(getLocal(column, lx, ground, lz)))
        continue;
      put(ctx, column, x + dx, ground + 1, z + dz, feature.block, true);
    }
  }
}
