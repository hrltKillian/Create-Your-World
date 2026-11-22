import { FLAG_REPLACEABLE, type Registry } from '../../content/registry.ts';
import type { BiomeDef, WorldgenDef } from '../../content/schema.ts';
import { fnv1aString, fnv1aU32, hash32, hashUnit } from '../../core/hash.ts';
import type { Column } from '../Column.ts';
import {
  columnIndex,
  localIndex,
  SECTION_BITS,
  SECTION_MASK,
  SECTION_SIZE,
  WORLD_HEIGHT,
} from '../coords.ts';
import { pickBiome } from './biomes.ts';
import { Climate, type ClimateSample, emptySample, interpolateSample } from './climate.ts';
import { FLAT_SURFACE, generateFlatColumn } from './flat.ts';
import { surfaceHeight } from './terrain.ts';

/** Bump when generation output changes: golden hashes and saves of untouched terrain depend on it. */
export const GEN_VERSION = 1;

interface ResolvedTree {
  readonly kind: 'broadleaf' | 'conifer';
  readonly log: number;
  readonly leaves: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly soil: ReadonlySet<number>;
}

interface ResolvedBiome {
  readonly def: BiomeDef;
  readonly surface: number;
  readonly filler: number;
  readonly seabed: number;
  readonly liquid: number;
  readonly liquidCap: number;
  readonly trees: readonly { readonly tree: ResolvedTree; readonly chance: number }[];
  readonly plants: readonly { readonly state: number; readonly chance: number }[];
}

export type WorldType = 'default' | 'flat';

/** Everything generation needs, built once per (seed, world type, content pack). */
export interface GenContext {
  readonly seed: string;
  readonly worldType: WorldType;
  readonly seedHash: number;
  readonly registry: Registry;
  readonly def: WorldgenDef;
  readonly biomes: readonly ResolvedBiome[];
  readonly climate: Climate;
  readonly bedrock: number;
  readonly stone: number;
  readonly deepStone: number;
  readonly spawnBiomes: ReadonlySet<number>;
  /** FNV hash of each state's text key (golden hashes survive content reordering). */
  readonly stateHash: Uint32Array;
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
  const state = (key: `block:${string}`) => registry.defaultState(key);
  const trees = new Map<string, ResolvedTree>();
  for (const feature of pack.features ?? []) {
    trees.set(feature.key, {
      kind: feature.kind,
      log: state(feature.log),
      leaves: state(feature.leaves),
      minHeight: feature.height[0],
      maxHeight: feature.height[1],
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
      trees: (b.trees ?? []).map((t) => {
        const tree = trees.get(t.feature);
        if (!tree) throw new Error(`Unknown feature "${t.feature}" in ${b.key}`);
        return { tree, chance: t.chance };
      }),
      plants: (b.plants ?? []).map((p) => ({ state: state(p.block), chance: p.chance })),
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
    climate: new Climate(seed, def),
    bedrock: state(def.bedrock),
    stone: state(def.stone),
    deepStone: state(def.deepStone),
    spawnBiomes: new Set(biomes.flatMap((b, i) => (spawnKeys.has(b.def.key) ? [i] : []))),
    stateHash,
  };
}

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

function jitterAt(ctx: GenContext, x: number, z: number): number {
  return (hashUnit(ctx.seedHash, x, z, 77) - 0.5) * 2 * ctx.def.biomeJitter;
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
  sampleAt(ctx, cache, x, z, sample);
  const height = surfaceHeight(sample, ctx.def);
  return {
    height,
    biome: pickBiome(
      ctx.biomes.map((b) => b.def),
      sample,
      height,
      jitterAt(ctx, x, z),
    ),
  };
}

/** Feet height for standing on the terrain at a block column (analytic, no generation needed). */
export function surfaceY(ctx: GenContext, x: number, z: number): number {
  if (ctx.worldType === 'flat') return FLAT_SURFACE + 1;
  return pointInfo(ctx, x, z).height + 1;
}

const tmp = emptySample();

/** Generates the terrain of one column (sections, heightmap, biomes). Pure and deterministic. */
export function generateColumn(ctx: GenContext, column: Column): void {
  if (ctx.worldType === 'flat') {
    // The flat test world uses the first spawn biome's surface (or the last biome).
    const index = ctx.spawnBiomes.values().next().value ?? ctx.biomes.length - 1;
    const biome = ctx.biomes[index]!;
    generateFlatColumn(column, {
      bedrock: ctx.bedrock,
      stone: ctx.stone,
      filler: biome.filler,
      surface: biome.surface,
    });
    column.biomes.fill(index);
    return;
  }
  const cache = new LatticeCache();
  const defs = ctx.biomes.map((b) => b.def);
  const x0 = column.cx * SECTION_SIZE;
  const z0 = column.cz * SECTION_SIZE;
  const sea = ctx.def.seaLevel;
  const heights = new Int16Array(1024);

  for (let lz = 0; lz < SECTION_SIZE; lz++) {
    for (let lx = 0; lx < SECTION_SIZE; lx++) {
      const x = x0 + lx;
      const z = z0 + lz;
      sampleAt(ctx, cache, x, z, tmp);
      const h = surfaceHeight(tmp, ctx.def);
      const biomeIndex = pickBiome(defs, tmp, h, jitterAt(ctx, x, z));
      const biome = ctx.biomes[biomeIndex]!;
      const cell = columnIndex(lx, lz);
      heights[cell] = h;
      column.biomes[cell] = biomeIndex;
      const fillerDepth = 3 + (hash32(ctx.seedHash, x, z, 3) & 1);
      for (let y = 0; y <= Math.max(h, sea); y++) {
        let state: number;
        if (y === 0) state = ctx.bedrock;
        else if (y < h - fillerDepth)
          state = y < ctx.def.deepStoneBelowY ? ctx.deepStone : ctx.stone;
        else if (y < h) state = biome.filler;
        else if (y === h) state = h < sea ? biome.seabed : biome.surface;
        else if (y === sea && biome.liquidCap >= 0) state = biome.liquidCap;
        else state = biome.liquid;
        setLocal(column, lx, y, lz, state);
      }
      // Plants on dry surface blocks.
      if (h >= sea && h + 1 < WORLD_HEIGHT) {
        for (const plant of biome.plants) {
          if (hashUnit(ctx.seedHash, x, z, 9) < plant.chance) {
            setLocal(column, lx, h + 1, lz, plant.state);
            break;
          }
        }
      }
    }
  }

  placeTrees(ctx, column, cache);

  for (let cell = 0; cell < 1024; cell++) {
    const lx = cell & 31;
    const lz = cell >> 5;
    // Start above the tallest thing generation can place (water surface or trees).
    let y = Math.min(WORLD_HEIGHT - 1, Math.max(heights[cell]!, sea) + 24);
    while (y > 0 && getLocal(column, lx, y, lz) === ctx.registry.air) y--;
    column.heightmap[cell] = y + 1;
  }
  for (const section of column.sections) section.compact();
}

function setLocal(column: Column, lx: number, y: number, lz: number, state: number): void {
  column.sections[y >> SECTION_BITS]!.setBlock(localIndex(lx, y & SECTION_MASK, lz), state);
}

function getLocal(column: Column, lx: number, y: number, lz: number): number {
  return column.sections[y >> SECTION_BITS]!.getBlock(localIndex(lx, y & SECTION_MASK, lz));
}

/**
 * Trees: at most one candidate per 8×8 cell. Every column replays the candidates of its 3×3
 * neighbourhood in a fixed order and writes only its own voxels, so the result does not depend on
 * the order in which columns are generated.
 */
function placeTrees(ctx: GenContext, column: Column, cache: LatticeCache): void {
  const x0 = column.cx * SECTION_SIZE;
  const z0 = column.cz * SECTION_SIZE;
  const reach = 7;
  const cellMinX = Math.floor((x0 - reach) / 8);
  const cellMaxX = Math.floor((x0 + SECTION_SIZE + reach) / 8);
  const cellMinZ = Math.floor((z0 - reach) / 8);
  const cellMaxZ = Math.floor((z0 + SECTION_SIZE + reach) / 8);
  const sample = emptySample();
  const defs = ctx.biomes.map((b) => b.def);
  for (let cz = cellMinZ; cz <= cellMaxZ; cz++) {
    for (let cx = cellMinX; cx <= cellMaxX; cx++) {
      const roll = hash32(ctx.seedHash, cx, cz, 21);
      const px = cx * 8 + (roll & 7);
      const pz = cz * 8 + ((roll >>> 3) & 7);
      sampleAt(ctx, cache, px, pz, sample);
      const h = surfaceHeight(sample, ctx.def);
      if (h < ctx.def.seaLevel) continue;
      const biome = ctx.biomes[pickBiome(defs, sample, h, jitterAt(ctx, px, pz))]!;
      if (biome.trees.length === 0 || !biome.trees.some((t) => t.tree.soil.has(biome.surface)))
        continue;
      let u = hashUnit(ctx.seedHash, cx, cz, 5);
      for (const option of biome.trees) {
        if (u < option.chance) {
          if (option.tree.soil.has(biome.surface)) {
            const span = option.tree.maxHeight - option.tree.minHeight + 1;
            const height = option.tree.minHeight + ((roll >>> 6) % span);
            writeTree(ctx, column, option.tree, px, h + 1, pz, height);
          }
          break;
        }
        u -= option.chance;
      }
    }
  }
}

function writeTree(
  ctx: GenContext,
  column: Column,
  tree: ResolvedTree,
  x: number,
  y0: number,
  z: number,
  height: number,
): void {
  const x0 = column.cx * SECTION_SIZE;
  const z0 = column.cz * SECTION_SIZE;
  const air = ctx.registry.air;
  const put = (wx: number, wy: number, wz: number, state: number, onlyAir: boolean) => {
    const lx = wx - x0;
    const lz = wz - z0;
    if (
      lx < 0 ||
      lz < 0 ||
      lx >= SECTION_SIZE ||
      lz >= SECTION_SIZE ||
      wy <= 0 ||
      wy >= WORLD_HEIGHT
    )
      return;
    if (onlyAir) {
      const current = getLocal(column, lx, wy, lz);
      if (current !== air && (ctx.registry.tables.flags[current]! & FLAG_REPLACEABLE) === 0) return;
    }
    setLocal(column, lx, wy, lz, state);
  };
  const top = y0 + height - 1;
  if (tree.kind === 'broadleaf') {
    for (let dy = -2; dy <= 1; dy++) {
      const radius = dy === 1 ? 1 : 2;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
          if (corner && hash32(ctx.seedHash, x + dx, top + dy, z + dz) % 3 !== 0) continue;
          put(x + dx, top + dy, z + dz, tree.leaves, true);
        }
      }
    }
  } else {
    // Conifer: stacked rings that shrink towards the tip.
    for (let dy = -height + 3; dy <= 1; dy++) {
      const fromTop = 1 - dy;
      const radius =
        fromTop <= 1 ? 0 : Math.min(3, 1 + ((fromTop - 1) >> 1) - (fromTop % 2 === 0 ? 1 : 0));
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > radius + 1) continue;
          put(x + dx, top + dy, z + dz, tree.leaves, true);
        }
      }
    }
  }
  for (let y = y0; y <= top; y++) put(x, y, z, tree.log, false);
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

/** Provisional spawn (M2–M5): nearest dry column of a spawn biome, spiralling out from the origin. */
export function findSpawn(ctx: GenContext, maxRadius = 64): { x: number; y: number; z: number } {
  if (ctx.worldType === 'flat') return { x: 0.5, y: FLAT_SURFACE + 1, z: 0.5 };
  const cache = new LatticeCache();
  for (let r = 0; r <= maxRadius; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = dx * SECTION_SIZE + 16;
        const z = dz * SECTION_SIZE + 16;
        const info = pointInfo(ctx, x, z, cache);
        if (
          info.height >= ctx.def.seaLevel + 1 &&
          (ctx.spawnBiomes.size === 0 || ctx.spawnBiomes.has(info.biome))
        ) {
          return { x: x + 0.5, y: info.height + 1, z: z + 0.5 };
        }
      }
    }
  }
  return { x: 0.5, y: ctx.def.seaLevel + 2, z: 0.5 };
}
