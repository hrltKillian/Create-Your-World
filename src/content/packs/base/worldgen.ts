import type { BiomeDef, FeatureDef, OreDef, WorldgenDef } from '../../schema.ts';
import type { PackI18nKey } from './i18n.en.ts';

/** Terrain shape and climate of the base pack. */
export const worldgen = {
  seaLevel: 62,
  deepStoneBelowY: 32,
  climateStep: 4,
  scales: {
    continental: 1400,
    erosion: 700,
    ridges: 450,
    temperature: 900,
    humidity: 700,
    toxicity: 550,
    detail: 48,
  },
  latitude: { amplitude: 0.45, period: 3000 },
  continentalSpline: [
    [-1, -34],
    [-0.45, -20],
    [-0.3, -6],
    [-0.1, 2],
    [0.15, 6],
    [0.45, 14],
    [1, 30],
  ],
  erosionSpline: [
    [-1, 110],
    [-0.5, 62],
    [-0.1, 26],
    [0.3, 10],
    [1, 3],
  ],
  detailAmplitude: 4,
  biomeBorder: { scale: 40, amplitude: 0.05 },
  bedrock: 'block:worldrock',
  stone: 'block:stone',
  deepStone: 'block:darkstone',
  magmaBelowY: 10,
  magma: 'block:magma',
  caves: {
    // Two tunnel families: long wide galleries and tighter winding passages that cross them.
    tunnels: [
      { scale: [72, 44], threshold: 0.0045 },
      { scale: [40, 26], threshold: 0.003 },
    ],
    tunnelWidth: { scale: 120, min: 0.5, max: 2.2 },
    // Halls deep down and nearer the surface.
    caverns: {
      scale: [90, 40],
      bands: [
        { y: [8, 36], threshold: 0.58 },
        { y: [40, 76], threshold: 0.62 },
      ],
    },
    surfaceMargin: 4,
    entrance: { scale: 24, threshold: 0.45 },
    ravines: { scale: 260, width: 0.03, depth: 30, gateScale: 700, gate: 0.2 },
    floodedDepth: 12,
    seal: 3,
  },
  banks: {
    below: 3,
    above: 1,
    scale: 24,
    depth: 2,
    patches: [
      { block: 'block:gravel', min: 0.2 },
      { block: 'block:clay', max: -0.35 },
    ],
  },
  spawn: {
    near: ['block:gravel'],
    nearRadius: 40,
    far: ['biome:fungal_marsh', 'biome:tundra', 'biome:ochre_desert'],
    farRadius: 1000,
  },
} as const satisfies WorldgenDef;

type PackBiome = BiomeDef & { readonly nameKey: PackI18nKey };

/** Seven surface biomes, tested in `order`. Cold lies north (−z), heat south (+z). */
export const biomes = [
  {
    key: 'biome:lake_basin',
    nameKey: 'biome.lake_basin',
    order: 1,
    all: [{ field: 'C', lt: -0.35 }],
    climate: { dayC: 18, nightC: 10 },
    surface: 'block:sand',
    filler: 'block:sand',
    seabed: 'block:clay',
    liquid: 'block:fresh_water',
    tints: { grass: '#86b25a', foliage: '#64a046', water: '#3a78c6' },
    fog: '#9cc0dc',
    plants: [{ block: 'block:tall_grass', chance: 0.05 }],
  },
  {
    key: 'biome:fungal_marsh',
    nameKey: 'biome.fungal_marsh',
    order: 2,
    all: [
      { field: 'X', gt: 0.41 },
      { field: 'T', gt: -0.2 },
    ],
    climate: { dayC: 24, nightC: 16 },
    toxicityPerMin: { day: 4, night: 7 },
    surface: 'block:peat',
    filler: 'block:silt',
    seabed: 'block:silt',
    liquid: 'block:foul_water',
    tints: { grass: '#7d8c45', foliage: '#6b7a3c', water: '#6e7a3f' },
    fog: '#9aa27c',
    features: [{ feature: 'feature:giant_mushroom', chance: 0.16 }],
    plants: [
      { block: 'block:tall_grass', chance: 0.1 },
      { block: 'block:glowbloom', chance: 0.02 },
    ],
  },
  {
    key: 'biome:tundra',
    nameKey: 'biome.tundra',
    order: 3,
    all: [{ field: 'T', lt: -0.35 }],
    climate: { dayC: -6, nightC: -16 },
    surface: 'block:snow',
    filler: 'block:permafrost',
    seabed: 'block:gravel',
    liquid: 'block:fresh_water',
    liquidCap: 'block:ice',
    tints: { grass: '#9fb59a', foliage: '#6f8a6b', water: '#4a7fb8' },
    fog: '#c7d6e2',
    features: [{ feature: 'feature:conifer', chance: 0.08 }],
    plants: [{ block: 'block:frost_lichen', chance: 0.05 }],
  },
  {
    key: 'biome:ochre_desert',
    nameKey: 'biome.ochre_desert',
    order: 4,
    all: [
      { field: 'T', gt: 0.38 },
      { field: 'H', lt: 0.15 },
    ],
    climate: { dayC: 44, nightC: 8 },
    surface: 'block:ochre_sand',
    filler: 'block:ochre_sandstone',
    seabed: 'block:ochre_sand',
    liquid: 'block:fresh_water',
    tints: { grass: '#bfae6a', foliage: '#a3984f', water: '#3f86b8' },
    fog: '#e3c79c',
    features: [
      { feature: 'feature:palmthorn', chance: 0.1 },
      { feature: 'feature:thornbush', chance: 0.04 },
      { feature: 'feature:sandstone_boulder', chance: 0.03 },
    ],
    plants: [{ block: 'block:dry_shrub', chance: 0.02 }],
  },
  {
    key: 'biome:highlands',
    nameKey: 'biome.highlands',
    order: 5,
    any: [
      { field: 'M', gt: 0.42 },
      { field: 'h', gt: 118 },
    ],
    climate: { dayC: 12, nightC: 2 },
    surface: 'block:grass',
    filler: 'block:dirt',
    seabed: 'block:gravel',
    liquid: 'block:fresh_water',
    tints: { grass: '#7fa05e', foliage: '#5b8448', water: '#3d74b8' },
    fog: '#a9bfd0',
    features: [
      { feature: 'feature:conifer', chance: 0.12 },
      { feature: 'feature:boulder', chance: 0.1 },
    ],
    plants: [{ block: 'block:tall_grass', chance: 0.04 }],
  },
  {
    key: 'biome:forest',
    nameKey: 'biome.forest',
    order: 6,
    all: [{ field: 'H', gt: 0.15 }],
    climate: { dayC: 20, nightC: 11 },
    surface: 'block:grass',
    filler: 'block:dirt',
    seabed: 'block:sand',
    liquid: 'block:fresh_water',
    tints: { grass: '#6fa84a', foliage: '#4f8f36', water: '#3a72c2' },
    fog: '#9dbdd6',
    features: [
      { feature: 'feature:broadleaf', chance: 0.55 },
      { feature: 'feature:conifer', chance: 0.1 },
    ],
    plants: [
      { block: 'block:tall_grass', chance: 0.1 },
      { block: 'block:berry_bush', chance: 0.015 },
    ],
  },
  {
    key: 'biome:meadow',
    nameKey: 'biome.meadow',
    order: 7,
    climate: { dayC: 22, nightC: 12 },
    surface: 'block:grass',
    filler: 'block:dirt',
    seabed: 'block:sand',
    liquid: 'block:fresh_water',
    tints: { grass: '#86b44f', foliage: '#5f9a3e', water: '#3f76c4' },
    fog: '#9fc2de',
    features: [
      { feature: 'feature:broadleaf', chance: 0.06 },
      { feature: 'feature:thornbush', chance: 0.03 },
    ],
    plants: [
      { block: 'block:tall_grass', chance: 0.16 },
      { block: 'block:berry_bush', chance: 0.008 },
    ],
  },
] as const satisfies readonly PackBiome[];

/**
 * Decoration features (biomes give their chance per 8×8 cell). Stone boulders belong to the rocky
 * highlands only (docs plan v2 « M16 »: no surface stone elsewhere).
 */
export const features = [
  {
    key: 'feature:broadleaf',
    kind: 'broadleaf',
    block: 'block:broadleaf_log',
    crown: 'block:foliage',
    size: [4, 6],
    soil: ['block:grass'],
  },
  {
    key: 'feature:conifer',
    kind: 'conifer',
    block: 'block:conifer_log',
    crown: 'block:needles',
    size: [6, 9],
    soil: ['block:grass', 'block:snow'],
  },
  {
    key: 'feature:giant_mushroom',
    kind: 'mushroom',
    block: 'block:mushroom_stem',
    crown: 'block:glowcap',
    size: [4, 7],
    soil: ['block:peat'],
  },
  {
    key: 'feature:boulder',
    kind: 'boulder',
    block: 'block:stone',
    size: [1, 2],
    soil: ['block:grass', 'block:snow', 'block:sand', 'block:gravel'],
  },
  {
    key: 'feature:sandstone_boulder',
    kind: 'boulder',
    block: 'block:ochre_sandstone',
    size: [1, 2],
    soil: ['block:ochre_sand'],
  },
  {
    key: 'feature:palmthorn',
    kind: 'column',
    block: 'block:palmthorn',
    size: [2, 4],
    soil: ['block:ochre_sand'],
  },
  {
    key: 'feature:thornbush',
    kind: 'patch',
    block: 'block:thornbush',
    size: [1, 3],
    soil: ['block:grass', 'block:ochre_sand'],
  },
] as const satisfies readonly FeatureDef[];

/**
 * Ores (docs plan v2 « M16 »), in layers: per section, `veins` attempts of probability `chance`.
 * Each step of the progression needs an ore of one biome (copper in the temperate lands, tin in
 * the tundra, bog iron in the marsh, fireclay in the desert: all within 1 km of the spawn); the
 * common emberstone covers every height of the stone so no layer is ever empty.
 */
export const ores = [
  {
    key: 'ore:emberstone',
    block: 'block:emberstone',
    biomes: '*',
    layers: [
      { y: [1, 40], chance: 0.6, veins: 4, size: [4, 8] },
      { y: [41, 120], chance: 0.8, veins: 6, size: [5, 10] },
      { y: [121, 210], chance: 0.7, veins: 5, size: [4, 9] },
    ],
    replaces: ['block:stone', 'block:darkstone'],
  },
  {
    key: 'ore:copper',
    block: 'block:copper_ore',
    biomes: ['biome:meadow', 'biome:forest', 'biome:highlands'],
    layers: [
      { y: [30, 80], chance: 0.8, veins: 6, size: [4, 8] },
      { y: [81, 150], chance: 0.5, veins: 4, size: [3, 6] },
    ],
    replaces: ['block:stone'],
  },
  {
    key: 'ore:cassiterite',
    block: 'block:cassiterite',
    biomes: ['biome:tundra'],
    layers: [
      { y: [45, 100], chance: 0.8, veins: 6, size: [3, 6] },
      { y: [101, 160], chance: 0.4, veins: 3, size: [3, 5] },
    ],
    replaces: ['block:stone'],
  },
  {
    // Pond bottoms of the marsh: the silt under the foul water.
    key: 'ore:bog_iron',
    block: 'block:bog_iron',
    biomes: ['biome:fungal_marsh'],
    layers: [{ y: [54, 62], chance: 1, veins: 24, size: [3, 6] }],
    replaces: ['block:silt'],
    underLiquid: true,
  },
  {
    key: 'ore:fireclay',
    block: 'block:fireclay',
    biomes: ['biome:ochre_desert'],
    layers: [{ y: [60, 85], chance: 0.9, veins: 8, size: [4, 8] }],
    replaces: ['block:ochre_sandstone', 'block:stone'],
  },
  {
    key: 'ore:dawn_crystal',
    block: 'block:dawn_crystal',
    biomes: '*',
    layers: [{ y: [5, 28], chance: 1, veins: 24, size: [2, 4] }],
    replaces: ['block:darkstone', 'block:stone'],
    caveWall: true,
  },
] as const satisfies readonly OreDef[];
