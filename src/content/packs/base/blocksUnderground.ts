import type { BlockDef } from '../../schema.ts';
import type { PackI18nKey } from './i18n.en.ts';
import { FUELS } from './recipes.ts';

type PackBlock = BlockDef & { readonly nameKey: PackI18nKey };

/** An ore or deposit: a cube mined with a pickaxe of `minTier`. */
const deposit = (
  key: `block:${string}`,
  nameKey: PackI18nKey,
  texture: `tex:${string}`,
  hardness: number,
  minTier: BlockDef['minTier'],
  extra: Partial<PackBlock> = {},
): PackBlock => ({
  key,
  nameKey,
  shape: 'cube',
  pass: 'opaque',
  textures: { all: texture },
  collision: 'full',
  opaque: true,
  hardness,
  tool: 'pick',
  minTier,
  drops: 'self',
  sound: 'stone',
  ...extra,
});

/** Underground blocks (M6): magma, lava at the bottom of caves (M29) and the ores of the biomes. */
export const undergroundBlocks = [
  {
    // Caves below y 10 fill with it (plan v3 « M29 »): the reference game's lava, slow and short,
    // bright and hot; it burns whoever steps in and hardens where water meets it.
    key: 'block:lava',
    nameKey: 'block.lava',
    states: ['level', 'falling'],
    shape: 'liquid',
    pass: 'opaque',
    cullGroup: 'lava',
    textures: { all: 'tex:lava' },
    collision: 'liquid',
    opaque: false,
    replaceable: true,
    light: { emit: 15, filter: 15 },
    // No heat around it: as in the reference game, it hurts only what is in it (or on it).
    contact: { damagePerSec: 20, ignites: true },
    hardness: 0,
    drops: 'none',
    sound: 'water',
    liquid: {
      drinkable: false,
      thirstPerSip: 0,
      toxicityPerSip: 0,
      fills: {},
      // A step every 1.5 s, holes found 2 blocks away, two levels lost a block: about 3 blocks.
      flow: { seconds: 1.5, holeSearch: 2, infinite: false, step: 2 },
      hardens: { source: 'block:darkstone', flow: 'block:stone' },
      // The reference game's lava: thick (a third of water's speeds), no swimming in it (the body
      // drags along, sinks and rises slowly), burning, never drowning, and opaque: an orange fog
      // that hides everything past a block.
      moveFactor: 0.35,
      drowns: false,
      swim: false,
      fog: { color: '#f2611a', near: 0.2, far: 1.4 },
    },
  },
  deposit('block:magma', 'block.magma', 'tex:magma', 2, 1, {
    light: { emit: 15 },
    // No heat around it: as in the reference game, it hurts only what is in it (or on it).
    contact: { damagePerSec: 4 },
    drops: 'none',
  }),
  // The common ore of every depth: a stone that burns (a fuel for fires and kilns).
  deposit('block:emberstone', 'block.emberstone', 'tex:emberstone', 2, 1, {
    item: { hintKey: 'where.emberstone', fuel: FUELS.emberstone },
  }),
  deposit('block:cassiterite', 'block.cassiterite', 'tex:cassiterite', 2.5, 2, {
    item: { hintKey: 'where.cassiterite' },
  }),
  deposit('block:bog_iron', 'block.bog_iron', 'tex:bog_iron', 2, 2, {
    sound: 'gravel',
    item: { hintKey: 'where.bog_iron' },
  }),
  deposit('block:fireclay', 'block.fireclay', 'tex:fireclay', 1.5, 2, {
    sound: 'soil',
    item: { hintKey: 'where.fireclay' },
  }),
  deposit('block:dawn_crystal', 'block.dawn_crystal', 'tex:dawn_crystal', 3, 3, {
    light: { emit: 7 },
    drops: 'loot:dawn_crystal',
    sound: 'glass',
  }),
] as const satisfies readonly PackBlock[];
