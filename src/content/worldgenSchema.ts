/**
 * World generation data (docs « Génération du monde »): the worldgen splines and rocks, caves,
 * banks, ores, biomes, features and structures. Re-exported by `schema.ts`.
 */
import type { BiomeKey, BlockKey, LootKey } from './schema.ts';

export type FeatureKey = `feature:${string}`;

/** Climate fields sampled by world generation (all roughly in [−1, 1]) plus the surface height. */
export type ClimateField = 'C' | 'E' | 'M' | 'T' | 'H' | 'X' | 'h';

export interface ClimateCondition {
  readonly field: ClimateField;
  readonly lt?: number;
  readonly gt?: number;
}

/** Piecewise-linear curve: sorted [input, output] points. */
export type Spline = readonly (readonly [number, number])[];

export interface WorldgenDef {
  readonly seaLevel: number;
  /** Stone from this y up; dark stone under it, all of it below `deepStoneBelowY − deepStoneBlend`. */
  readonly deepStoneBelowY: number;
  /**
   * Rows under `deepStoneBelowY` where stone and dark stone mix cell by cell, dark stone ever more
   * often lower down (plan v3 « M29 »: no sharp line). 0: a sharp line.
   */
  readonly deepStoneBlend: number;
  /** Climate lattice spacing in blocks (bilinear interpolation in between). */
  readonly climateStep: number;
  /** Noise wavelengths in blocks. */
  readonly scales: Readonly<
    Record<
      'continental' | 'erosion' | 'ridges' | 'temperature' | 'humidity' | 'toxicity' | 'detail',
      number
    >
  >;
  /** Temperature band along z: triangle wave (cold to the north at −period/4, hot to the south). */
  readonly latitude: { readonly amplitude: number; readonly period: number };
  readonly continentalSpline: Spline;
  /** Erosion → amplitude of the ridges term. */
  readonly erosionSpline: Spline;
  readonly detailAmplitude: number;
  /**
   * Biome thresholds are shifted by a smooth noise (± `amplitude`, wavelength about `scale`
   * blocks): borders are clean wavy lines, never a dither of single columns.
   */
  readonly biomeBorder: { readonly scale: number; readonly amplitude: number };
  readonly bedrock: BlockKey;
  readonly stone: BlockKey;
  readonly deepStone: BlockKey;
  /** Cave cells below this y fill with `magma` instead of air. */
  readonly magmaBelowY: number;
  readonly magma: BlockKey;
  readonly caves: CaveDef;
  readonly banks: BankDef;
  /** Spawn rules; without them the spawn is the nearest dry column of a spawn biome. */
  readonly spawn?: SpawnDef;
}

/**
 * Spawn point (docs « Point d'apparition »): a dry column of a spawn biome (pack bindings) with
 * water and the `near` surface blocks within `nearRadius` blocks, and the `far` biomes within
 * `farRadius` blocks. The water is the spawn biome's liquid.
 */
export interface SpawnDef {
  readonly near: readonly BlockKey[];
  readonly nearRadius: number;
  readonly far: readonly BiomeKey[];
  readonly farRadius: number;
}

/**
 * Caves (docs « Génération » step 5): 3D noise sampled on a 4×4×4 lattice, trilinear in between.
 * Wavelengths are in blocks (horizontal, vertical).
 */
/**
 * Caves (docs plan v2 « M16 »): tunnel families that cross each other, caverns in depth bands,
 * entrances and ravines on dry land, caves flooded under lake beds and sealed below them.
 */
export interface CaveDef {
  /**
   * Noodle tunnels, one family each: open where n1² + n2² < threshold × the local width factor.
   * Independent families cross into junctions.
   */
  readonly tunnels: readonly {
    readonly scale: readonly [number, number];
    readonly threshold: number;
  }[];
  /** The width factor of the tunnels: a 2D noise of wavelength `scale` mapped to [min, max]. */
  readonly tunnelWidth: { readonly scale: number; readonly min: number; readonly max: number };
  /** Caverns where a 3D noise of `scale` exceeds the band's threshold, in each band's y range. */
  readonly caverns: {
    readonly scale: readonly [number, number];
    readonly bands: readonly {
      readonly y: readonly [number, number];
      readonly threshold: number;
    }[];
  };
  /** Nothing is carved within this many blocks of the surface… */
  readonly surfaceMargin: number;
  /** …except at entrances, where a 2D noise of this wavelength exceeds `threshold`. */
  readonly entrance: { readonly scale: number; readonly threshold: number };
  /**
   * Ravines: cracks from the surface down to `depth` blocks where a 2D noise of `scale` lies
   * within ±`width` of 0, only where a gate noise of `gateScale` exceeds `gate`.
   */
  readonly ravines: {
    readonly scale: number;
    readonly width: number;
    readonly depth: number;
    readonly gateScale: number;
    readonly gate: number;
  };
  /** Under a lake, caves within `floodedDepth` blocks of its bed are generated full of its liquid. */
  readonly floodedDepth: number;
  /** Dry caves keep at least this many blocks of rock between them and any liquid. */
  readonly seal: number;
}

/**
 * Gravel and clay banks along the shores: where the surface lies within [seaLevel − below,
 * seaLevel + above], a 2D noise of wavelength `scale` picks the first patch whose range holds it.
 * A bank replaces the top `depth` blocks.
 */
export interface BankDef {
  readonly below: number;
  readonly above: number;
  readonly scale: number;
  readonly depth: number;
  /** The noise range of each patch: min ≤ n < max (an absent bound is open). */
  readonly patches: readonly {
    readonly block: BlockKey;
    readonly min?: number;
    readonly max?: number;
  }[];
}

export type StructureKey = `structure:${string}`;

/**
 * A structure (docs « Génération » step 8). Each 128×128 region has one candidate point; where
 * the biome there lists structures, one may stand on the ground at that point.
 */
export interface StructureDef {
  readonly key: StructureKey;
  readonly biomes: readonly BiomeKey[];
  /** Chance per region whose candidate lies in one of `biomes` (the chances of a biome add up). */
  readonly chance: number;
  /**
   * Layers from the ground up (at most 24 wide, 10 high and 24 deep), each a list of rows from
   * north to south with one character per block from west to east. `.` is the biome's surface on
   * the bottom layer and air above it; any other character is a block state of `legend`.
   */
  readonly layers: readonly (readonly string[])[];
  /** Character → block state key, e.g. `block:planks` or `block:broadleaf_log[axis=x]`. */
  readonly legend: Readonly<Record<string, string>>;
  /** Character of a container block (a chest) → the loot table that fills it when generated. */
  readonly lootTables?: Readonly<Record<string, LootKey>>;
  /**
   * A story structure (plan v3 « M26 »): once per world, at the nearest flat, dry spot of its
   * biomes whose distance from the spawn lies in `distance` (blocks); `chance` is unused.
   */
  readonly place?: { readonly distance: readonly [number, number] };
}

export type OreKey = `ore:${string}`;

/**
 * Ore veins (docs « Génération » step 6), drawn from a per-section random stream: each vein is a
 * small walk around a centre at least 2 blocks inside the section, and only replaces `replaces`.
 */
/**
 * A layer of an ore (docs plan v2 « M16 »): in each section that reaches y (inclusive), `veins`
 * attempts each start a vein with probability `chance`, of `size` blocks; no vein block ever lies
 * outside y. Nothing else depends on depth: frequency and size come only from the layers.
 */
export interface OreLayer {
  readonly y: readonly [number, number];
  readonly chance: number;
  readonly veins: number;
  /** Inclusive range of blocks per vein. */
  readonly size: readonly [number, number];
}

export interface OreDef {
  readonly key: OreKey;
  readonly block: BlockKey;
  /** Biomes of the vein centre's column ('*': every biome, a common ore). */
  readonly biomes: readonly BiomeKey[] | '*';
  readonly layers: readonly OreLayer[];
  readonly replaces: readonly BlockKey[];
  /** Only blocks touching a cave (an air face neighbour) turn to ore. */
  readonly caveWall?: boolean;
  /** Veins start only under the liquid, where the vein centre's column lies below the sea level. */
  readonly underLiquid?: boolean;
}

export interface BiomeDef {
  readonly key: BiomeKey;
  readonly nameKey: string;
  /** Biomes are tested in ascending order; the first whose conditions all hold wins. */
  readonly order: number;
  readonly all?: readonly ClimateCondition[];
  /** At least one must hold (when present). */
  readonly any?: readonly ClimateCondition[];
  readonly climate: { readonly dayC: number; readonly nightC: number };
  readonly toxicityPerMin?: { readonly day: number; readonly night: number };
  readonly surface: BlockKey;
  readonly filler: BlockKey;
  /** Surface block when under the liquid level. */
  readonly seabed: BlockKey;
  readonly liquid: BlockKey;
  /** Replaces the top liquid layer (frozen lakes). */
  readonly liquidCap?: BlockKey;
  readonly tints: Readonly<Record<'grass' | 'foliage' | 'water', string>>;
  /** The air's colour there (plan v4 « M39 »): it tints the horizon, the fog and the sky a little. */
  readonly fog: string;
  /** How strong the auroras are there at night, 0–1 (none by default; plan v4 « M39 »). */
  readonly aurora?: number;
  /** Fireflies or glowing spores in the air there at night (plan v4 « M40 »): colour, how many. */
  readonly motes?: { readonly color: string; readonly count: number };
  /**
   * Decoration: features with their chance per 8×8 cell (one candidate per cell, the chances add
   * up), and plants with their chance per surface block.
   */
  readonly features?: readonly { readonly feature: FeatureKey; readonly chance: number }[];
  readonly plants?: readonly { readonly block: BlockKey; readonly chance: number }[];
  /**
   * Sub-zones (plan v3 « M23 »): a slow noise of `scale` blocks multiplies the features' chances
   * by 1 + `contrast` × n (n in −1…1, never below 0): clearings where it is low, dense groves
   * where it is high.
   */
  readonly groves?: { readonly scale: number; readonly contrast: number };
  /** What a rod fishes out of its fishing waters, instead of the liquid's `fish` (plan v3 « M33 »). */
  readonly fish?: LootKey;
  /** What falls there in wet weather (plan v3 « M34 »): rain by default, snow, or nothing. */
  readonly precipitation?: 'rain' | 'snow' | 'none';
}

/**
 * Decoration shapes: trees (trunk + canopy: round, conical, or a willow's dome with hanging
 * strands), giant mushrooms (stem + cap), boulders (a mound of `block`), columns (a stack of
 * `block`) and patches (`block` on the surface around the centre).
 */
export type FeatureKind =
  | 'broadleaf'
  | 'conifer'
  | 'willow'
  | 'mushroom'
  | 'boulder'
  | 'column'
  | 'patch';

/** A decoration feature. Every shape stays within 7 blocks of its centre horizontally. */
export interface FeatureDef {
  readonly key: FeatureKey;
  readonly kind: FeatureKind;
  /** Trunk, stem, column, boulder or patch block. */
  readonly block: BlockKey;
  /** Canopy or cap (trees and mushrooms). */
  readonly crown?: BlockKey;
  /** Inclusive range: trunk, stem or column height; boulder or patch radius. */
  readonly size: readonly [number, number];
  /** The feature only grows on these surface blocks. */
  readonly soil: readonly BlockKey[];
  /** A giant's 2×2 trunk and its wider crown (trees only; 1 when absent). */
  readonly trunk?: 1 | 2;
}
