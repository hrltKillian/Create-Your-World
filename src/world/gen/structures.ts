import { FLAG_SOLID, type Registry } from '../../content/registry.ts';
import type { BiomeDef, StructureDef, StructureKey } from '../../content/schema.ts';
import { hash32, hashUnit } from '../../core/hash.ts';
import type { Column } from '../Column.ts';
import { columnIndex, localIndex, SECTION_BITS, SECTION_SIZE, WORLD_HEIGHT } from '../coords.ts';
import { caveAt, PADDED } from './caves.ts';
import { emptySample } from './climate.ts';
import type { GenContext } from './generateColumn.ts';
import { biomeOf, heightAt, type LatticeCache } from './sample.ts';

/*
 * Structures (docs « Génération » step 8): each 128×128 region has one candidate point, a pure
 * function of the seed; where its biome lists structures, one may stand there on flat, dry ground.
 * The site is analytic (heights, biome and caves only), and each column writes only its own part
 * of it, so the result does not depend on the order in which columns are generated.
 */

/** Side of a region (at most one structure each), and its log2. */
export const REGION = 128;
const REGION_BITS = 7;
/** Largest template side (blocks). */
const MAX_SIDE = 24;
/**
 * Footprints stay this far inside their region. Features give way to a structure within the
 * feature reach (7) of its footprint, so that area stays 8 blocks inside the region, out of reach
 * of the features a column of another region places: a column only deals with its own region.
 */
const MARGIN = 15;
/** Candidate points per axis of a region (the footprint's centre, whatever its size, fits). */
const SPAN = REGION - 2 * (MARGIN + MAX_SIDE / 2);
/** The ground of a site may lie this far above or below its centre. */
const MAX_SLOPE = 2;
/** Most filler blocks a foundation puts under a footprint cell. */
const FOUNDATION = 8;
/** Template cell: the biome's surface on the bottom layer, air above it. */
export const GROUND = -1;
const SALT_POINT = 51;
const SALT_PICK = 52;

/** A structure of the pack with its template and chances resolved. */
export interface ResolvedStructure {
  readonly key: StructureKey;
  /** Chance per biome index (0 where the structure never appears). */
  readonly chances: Float64Array;
  /** Template size: x, layers, z. */
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** State of each template cell (index x + z·width + layer·width·depth), GROUND for `.`. */
  readonly cells: Int32Array;
}

/** A structure placed in a region: the north-west corner of its footprint and its ground y. */
export interface StructureSite {
  readonly structure: ResolvedStructure;
  readonly x0: number;
  readonly z0: number;
  readonly y: number;
}

export function resolveStructure(
  def: StructureDef,
  biomes: readonly BiomeDef[],
  registry: Registry,
): ResolvedStructure {
  const height = def.layers.length;
  const depth = def.layers[0]!.length;
  const width = def.layers[0]![0]!.length;
  const cells = new Int32Array(width * height * depth);
  def.layers.forEach((rows, layer) => {
    rows.forEach((row, z) => {
      for (let x = 0; x < width; x++) {
        const char = row[x]!;
        cells[x + z * width + layer * width * depth] =
          char === '.' ? GROUND : registry.stateId(def.legend[char]!);
      }
    });
  });
  return {
    key: def.key,
    chances: Float64Array.from(biomes, (b) => (def.biomes.includes(b.key) ? def.chance : 0)),
    width,
    height,
    depth,
    cells,
  };
}

/** Region of a block coordinate. */
export function regionOf(v: number): number {
  return v >> REGION_BITS;
}

/** The structure a candidate draws (`u` in [0, 1)) in a biome, or null. */
function pickStructure(ctx: GenContext, biome: number, u: number): ResolvedStructure | null {
  let rest = u;
  for (const structure of ctx.structures) {
    const chance = structure.chances[biome]!;
    if (rest < chance) return structure;
    rest -= chance;
  }
  return null;
}

const sample = emptySample();

/** The structure of region (rx, rz), or null. Analytic: nothing is generated. */
export function siteIn(
  ctx: GenContext,
  cache: LatticeCache,
  rx: number,
  rz: number,
): StructureSite | null {
  if (ctx.structures.length === 0) return null;
  const roll = hash32(ctx.seedHash, rx, rz, SALT_POINT);
  const x = rx * REGION + MARGIN + MAX_SIDE / 2 + ((roll & 0xffff) % SPAN);
  const z = rz * REGION + MARGIN + MAX_SIDE / 2 + ((roll >>> 16) % SPAN);
  const sea = ctx.def.seaLevel;
  const y = heightAt(ctx, cache, x, z, sample);
  if (y <= sea || y + 1 >= WORLD_HEIGHT) return null;
  const biome = biomeOf(ctx, sample, y, x, z);
  const structure = pickStructure(ctx, biome, hashUnit(ctx.seedHash, rx, rz, SALT_PICK));
  if (!structure) return null;
  const x0 = x - (structure.width >> 1);
  const z0 = z - (structure.depth >> 1);
  // Dry and flat enough: corners, edge middles and centre of the footprint.
  for (let i = 0; i <= 2; i++) {
    for (let k = 0; k <= 2; k++) {
      const ground = heightAt(
        ctx,
        cache,
        x0 + (((structure.width - 1) * i) >> 1),
        z0 + (((structure.depth - 1) * k) >> 1),
      );
      if (ground <= sea || Math.abs(ground - y) > MAX_SLOPE) return null;
    }
  }
  // An entrance may have carved the ground away.
  if (caveAt(ctx, cache, x, y, z)) return null;
  return { structure, x0, z0, y };
}

/** Whether (x, z) lies within `margin` blocks of the site's footprint (a square margin). */
export function nearSite(site: StructureSite, x: number, z: number, margin: number): boolean {
  return (
    x >= site.x0 - margin &&
    x < site.x0 + site.structure.width + margin &&
    z >= site.z0 - margin &&
    z < site.z0 + site.structure.depth + margin
  );
}

/** The structure site of a column's region, or null. */
export function columnSite(
  ctx: GenContext,
  cache: LatticeCache,
  column: Column,
): StructureSite | null {
  const shift = REGION_BITS - SECTION_BITS;
  return siteIn(ctx, cache, column.cx >> shift, column.cz >> shift);
}

/**
 * Writes the column's part of its region's structure: the biome's filler under the bottom layer
 * down to solid ground (over water, a dip or a cave entrance), then the template, then air up to
 * the ground and its plants where the ground is higher.
 */
export function placeStructure(
  ctx: GenContext,
  column: Column,
  heights: Int16Array,
  site: StructureSite | null,
): void {
  if (!site) return;
  const s = site.structure;
  const air = ctx.registry.air;
  const x0 = column.cx * SECTION_SIZE;
  const z0 = column.cz * SECTION_SIZE;
  const lx0 = Math.max(0, site.x0 - x0);
  const lx1 = Math.min(SECTION_SIZE, site.x0 + s.width - x0);
  const lz0 = Math.max(0, site.z0 - z0);
  const lz1 = Math.min(SECTION_SIZE, site.z0 + s.depth - z0);
  const layerSize = s.width * s.depth;
  for (let lz = lz0; lz < lz1; lz++) {
    for (let lx = lx0; lx < lx1; lx++) {
      const ground = heights[(lz + 1) * PADDED + lx + 1]!;
      const biome = ctx.biomes[column.biomes[columnIndex(lx, lz)]!]!;
      const cell = x0 + lx - site.x0 + (z0 + lz - site.z0) * s.width;
      for (let y = site.y - 1; y >= site.y - FOUNDATION && !solid(ctx, column, lx, y, lz); y--)
        set(column, lx, y, lz, biome.filler);
      const top = Math.min(WORLD_HEIGHT - 1, Math.max(ground + 1, site.y + s.height - 1));
      for (let y = site.y; y <= top; y++) {
        const layer = y - site.y;
        let state = layer < s.height ? s.cells[cell + layer * layerSize]! : GROUND;
        if (state === GROUND) state = layer === 0 ? biome.surface : air;
        set(column, lx, y, lz, state);
      }
    }
  }
}

function solid(ctx: GenContext, column: Column, lx: number, y: number, lz: number): boolean {
  const state = column.sections[y >> SECTION_BITS]!.getBlock(localIndex(lx, y & 31, lz));
  return (ctx.registry.tables.flags[state]! & FLAG_SOLID) !== 0;
}

function set(column: Column, lx: number, y: number, lz: number, state: number): void {
  column.sections[y >> SECTION_BITS]!.setBlock(localIndex(lx, y & 31, lz), state);
}
