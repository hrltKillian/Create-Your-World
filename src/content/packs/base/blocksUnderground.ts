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

/** Underground blocks (M6): magma at the bottom of caves and the ores of the biomes. */
export const undergroundBlocks = [
  deposit('block:magma', 'block.magma', 'tex:magma', 2, 1, {
    light: { emit: 15 },
    heat: { celsius: 40, radius: 3 },
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
