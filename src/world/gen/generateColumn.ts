import type { Registry } from '../../content/registry.ts';
import type { BiomeDef, BlockKey, WorldgenDef } from '../../content/schema.ts';
import { fnv1aString, fnv1aU32, hash32 } from '../../core/hash.ts';
import { type Noise2, noise2 } from '../../core/noise.ts';
import type { Column } from '../Column.ts';
import {
  columnIndex,
  localIndex,
  SECTION_BITS,
  SECTION_MASK,
  SECTION_SIZE,
  WORLD_HEIGHT,
} from '../coords.ts';
import { placeArena, type ResolvedArena, resolveArena } from './arena.ts';
import { bankAt, type ResolvedBanks, resolveBanks } from './banks.ts';
import {
  type CaveNoise,
  carveCaves,
  caveAt,
  createCaveNoise,
  heightIndex,
  MARGIN,
  PADDED,
} from './caves.ts';
import { Climate, emptySample } from './climate.ts';
import { placeFeatures, placePlants, type ResolvedFeature } from './decor.ts';
import { FLAT_SURFACE, generateFlatColumn } from './flat.ts';
import { placeOres, type ResolvedOre } from './ores.ts';
import { heightAt, LatticeCache, rawBiomeOf, settledBiome } from './sample.ts';
import {
  columnSite,
  placeStructure,
  type ResolvedStructure,
  resolveStructure,
} from './structures.ts';

/** Bump when generation output changes: golden hashes and saves of untouched terrain depend on it. */
export const GEN_VERSION = 7;

export interface ResolvedBiome {
  readonly def: BiomeDef;
  readonly surface: number;
  readonly filler: number;
  readonly seabed: number;
  readonly liquid: number;
  readonly liquidCap: number;
  readonly features: readonly { readonly feature: ResolvedFeature; readonly chance: number }[];
  readonly plants: readonly { readonly state: number; readonly chance: number }[];
}

/** `flat` and `arena` are test worlds: flat ground (the arena adds a few features near the spawn). */
export type WorldType = 'default' | 'flat' | 'arena';
export const WORLD_TYPES: readonly WorldType[] = ['default', 'flat', 'arena'];

/** Everything generation needs, built once per (seed, world type, content pack). */
export interface GenContext {
  readonly seed: string;
  readonly worldType: WorldType;
  readonly seedHash: number;
  readonly registry: Registry;
  readonly def: WorldgenDef;
  readonly biomes: readonly ResolvedBiome[];
  /** The biome definitions, in the order of `biomes`. */
  readonly biomeDefs: readonly BiomeDef[];
  readonly climate: Climate;
  /** The smooth shift of biome thresholds (`WorldgenDef.biomeBorder`). */
  readonly border: Noise2;
  readonly caves: CaveNoise;
  readonly banks: ResolvedBanks;
  readonly ores: readonly ResolvedOre[];
  readonly structures: readonly ResolvedStructure[];
  readonly bedrock: number;
  readonly stone: number;
  readonly deepStone: number;
  readonly magma: number;
  readonly spawnBiomes: ReadonlySet<number>;
  /** FNV hash of each state's text key (golden hashes survive content reordering). */
  readonly stateHash: Uint32Array;
  /** Features of the arena world (null for the other world types). */
  readonly arena: ResolvedArena | null;
}

/** Whether a world type is flat ground at FLAT_SURFACE. */
export function isFlatWorld(worldType: WorldType): boolean {
  return worldType !== 'default';
}

export function createGenContext(
  seed: string,
  registry: Registry,
  worldType: WorldType = 'default',
): GenContext {
  const pack = registry.pack;
  const def = pack.worldgen;
  if (!def || !pack.biomes || pack.biomes.length === 0)
    throw new Error('The content pack has no world generation data');
  const state = (key: BlockKey) => registry.defaultState(key);
  const features = new Map<string, ResolvedFeature>();
  for (const feature of pack.features ?? []) {
    features.set(feature.key, {
      kind: feature.kind,
      block: state(feature.block),
      crown: feature.crown ? state(feature.crown) : -1,
      size0: feature.size[0],
      size1: feature.size[1],
      soil: new Set(feature.soil.map(state)),
    });
  }
  const sorted = [...pack.biomes].sort((a, b) => a.order - b.order);
  const biomes = sorted.map(
    (b): ResolvedBiome => ({
      def: b,
      surface: state(b.surface),
      filler: state(b.filler),
      seabed: state(b.seabed),
      liquid: state(b.liquid),
      liquidCap: b.liquidCap ? state(b.liquidCap) : -1,
      features: (b.features ?? []).map((f) => {
        const feature = features.get(f.feature);
        if (!feature) throw new Error(`Unknown feature "${f.feature}" in ${b.key}`);
        return { feature, chance: f.chance };
      }),
      plants: (b.plants ?? []).map((p) => ({ state: state(p.block), chance: p.chance })),
    }),
  );
  const ores = (pack.ores ?? []).map(
    (ore): ResolvedOre => ({
      block: state(ore.block),
      biomes: Uint8Array.from(sorted, (b) =>
        ore.biomes === '*' || ore.biomes.includes(b.key) ? 1 : 0,
      ),
      layers: ore.layers.map((layer) => ({
        y0: layer.y[0],
        y1: layer.y[1],
        chance: layer.chance,
        veins: layer.veins,
        size0: layer.size[0],
        size1: layer.size[1],
      })),
      replaces: new Set(ore.replaces.map(state)),
      caveWall: ore.caveWall === true,
      underLiquid: ore.underLiquid === true,
    }),
  );
  const spawnKeys = new Set<string>(pack.manifest.bindings.spawnBiomes ?? []);
  const stateHash = new Uint32Array(registry.states.length);
  registry.states.forEach((s) => {
    stateHash[s.id] = fnv1aString(s.key);
  });
  return {
    seed,
    worldType,
    seedHash: fnv1aString(seed),
    registry,
    def,
    biomes,
    biomeDefs: sorted,
    climate: new Climate(seed, def),
    border: noise2(seed, 'biome.border'),
    caves: createCaveNoise(seed, def.caves),
    banks: resolveBanks(seed, def.banks, state),
    ores,
    structures: (pack.structures ?? []).map((s) => resolveStructure(s, sorted, registry)),
    bedrock: state(def.bedrock),
    stone: state(def.stone),
    deepStone: state(def.deepStone),
    magma: state(def.magma),
    spawnBiomes: new Set(biomes.flatMap((b, i) => (spawnKeys.has(b.def.key) ? [i] : []))),
    stateHash,
    arena: worldType === 'arena' ? resolveArena(registry) : null,
  };
}

/**
 * Feet height for standing on the terrain at a block column (analytic, no generation needed): on
 * the floor of a ravine or cave entrance that opens the surface there.
 */
export function surfaceY(ctx: GenContext, x: number, z: number): number {
  if (isFlatWorld(ctx.worldType)) return FLAT_SURFACE + 1;
  const cache = new LatticeCache();
  let y = heightAt(ctx, cache, x, z);
  while (y > 1 && caveAt(ctx, cache, x, y, z)) y--;
  return y + 1;
}

const tmp = emptySample();
/** Surface heights of the column and of a MARGIN-block ring around it (caves look at neighbours). */
const heights = new Int16Array(PADDED * PADDED);
/** Raw biomes (before lone columns are settled) of the same grid. */
const rawBiomes = new Uint8Array(PADDED * PADDED);

/**
 * Generates one column (sections, heightmap, biomes): terrain, caves and magma, ores, plants,
 * features and structures (docs « Génération » steps 4–8). Pure and deterministic.
 */
export function generateColumn(ctx: GenContext, column: Column): void {
  if (isFlatWorld(ctx.worldType)) {
    // The flat test worlds use the first spawn biome's surface (or the last biome).
    const index = ctx.spawnBiomes.values().next().value ?? ctx.biomes.length - 1;
    const biome = ctx.biomes[index]!;
    generateFlatColumn(column, {
      bedrock: ctx.bedrock,
      stone: ctx.stone,
      filler: biome.filler,
      surface: biome.surface,
    });
    column.biomes.fill(index);
    if (ctx.arena) placeArena(column, ctx.arena);
    return;
  }
  const cache = new LatticeCache();
  const x0 = column.cx * SECTION_SIZE - MARGIN;
  const z0 = column.cz * SECTION_SIZE - MARGIN;
  // Heights and raw biomes of the padded grid, then each column's biome settled from its
  // neighbours' raw ones (`biomeOf`'s rule, without sampling a point twice).
  for (let pz = 0; pz < PADDED; pz++) {
    for (let px = 0; px < PADDED; px++) {
      const i = pz * PADDED + px;
      heights[i] = heightAt(ctx, cache, x0 + px, z0 + pz, tmp);
      rawBiomes[i] = rawBiomeOf(ctx, tmp, x0 + px, z0 + pz);
    }
  }
  for (let lz = 0; lz < SECTION_SIZE; lz++) {
    for (let lx = 0; lx < SECTION_SIZE; lx++) {
      const i = heightIndex(lx, lz);
      const biome = settledBiome(
        rawBiomes[i]!,
        rawBiomes[i - 1]!,
        rawBiomes[i + 1]!,
        rawBiomes[i - PADDED]!,
        rawBiomes[i + PADDED]!,
      );
      column.biomes[columnIndex(lx, lz)] = biome;
      fillTerrain(ctx, column, lx, lz, heights[i]!, ctx.biomes[biome]!);
    }
  }
  carveCaves(ctx, column, heights);
  placeOres(ctx, column, heights);
  const site = columnSite(ctx, cache, column);
  placePlants(ctx, column, heights);
  placeFeatures(ctx, column, heights, cache, site);
  placeStructure(ctx, column, heights, site);
  fillHeightmap(ctx, column);
  for (const section of column.sections) section.compact();
}

/**
 * Worldrock, deep stone, stone, 3 or 4 filler blocks and the surface (or a shore bank), then the
 * biome's liquid up to the sea level.
 */
function fillTerrain(
  ctx: GenContext,
  column: Column,
  lx: number,
  lz: number,
  h: number,
  biome: ResolvedBiome,
): void {
  const sea = ctx.def.seaLevel;
  const x = column.cx * SECTION_SIZE + lx;
  const z = column.cz * SECTION_SIZE + lz;
  const fillerDepth = 3 + (hash32(ctx.seedHash, x, z, 3) & 1);
  const bank = bankAt(ctx, x, z, h);
  const bankFrom = bank >= 0 ? h - ctx.banks.def.depth + 1 : WORLD_HEIGHT;
  for (let y = 0; y <= Math.max(h, sea); y++) {
    let state: number;
    if (y === 0) state = ctx.bedrock;
    else if (y >= bankFrom && y <= h) state = bank;
    else if (y < h - fillerDepth) state = y < ctx.def.deepStoneBelowY ? ctx.deepStone : ctx.stone;
    else if (y < h) state = biome.filler;
    else if (y === h) state = h < sea ? biome.seabed : biome.surface;
    else if (y === sea && biome.liquidCap >= 0) state = biome.liquidCap;
    else state = biome.liquid;
    column.sections[y >> SECTION_BITS]!.setBlock(localIndex(lx, y & SECTION_MASK, lz), state);
  }
}

/** Heightmap: highest non-air block + 1, scanning down from the highest non-empty section. */
function fillHeightmap(ctx: GenContext, column: Column): void {
  const air = ctx.registry.air;
  let top = column.sections.length - 1;
  while (top > 0 && column.sections[top]!.isEmpty(air)) top--;
  for (let cell = 0; cell < 1024; cell++) {
    const lx = cell & 31;
    const lz = cell >> 5;
    let y = top * SECTION_SIZE + SECTION_MASK;
    while (y > 0 && column.getBlock(lx, y, lz) === air) y--;
    column.heightmap[cell] = y + 1;
  }
}

/** Order-independent hash of a generated column (golden tests). */
export function columnHash(ctx: GenContext, column: Column): number {
  let h = fnv1aU32(0x811c9dc5, column.cx);
  h = fnv1aU32(h, column.cz);
  for (const section of column.sections) {
    for (let i = 0; i < SECTION_SIZE * SECTION_SIZE * SECTION_SIZE; i++)
      h = fnv1aU32(h, ctx.stateHash[section.getBlock(i)]!);
  }
  return h;
}
