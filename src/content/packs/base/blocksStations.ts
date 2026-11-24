import type { BlockDef, Box16 } from '../../schema.ts';
import { cube } from './blocksNature.ts';
import type { PackI18nKey } from './i18n.en.ts';

type PackBlock = BlockDef & { readonly nameKey: PackI18nKey };

/** A low ring of stones around crossed logs. */
const CAMPFIRE: readonly Box16[] = [[1, 0, 1, 15, 5, 15]];
const CHEST: readonly Box16[] = [[1, 0, 1, 15, 14, 15]];
/** A mat lying flat, head to the north when facing north. */
const BEDROLL: readonly Box16[] = [[2, 0, 0, 14, 2, 16]];
const LANTERN: readonly Box16[] = [[4, 0, 4, 12, 10, 12]];
/** A squat bag on the ground. */
const PACK: readonly Box16[] = [[3, 0, 4, 13, 9, 12]];

/**
 * Crafted building blocks, stations and furniture (M8). Station blocks name their station
 * (`recipes.ts`); the processing ones keep a block entity whose fire drives the `lit` state, with
 * the light and heat of « Survie » (fire +25 °C over 4 blocks, kilns +15 °C over 3). The bedroll is
 * slept on (M9); the Abandoned Pack holds what a dead player carried, cannot be broken and goes
 * once emptied.
 */
export const stationBlocks = [
  cube('block:cut_stone', 'block.cut_stone', 'tex:cut_stone', 2, 'stone', {
    tool: 'pick',
    minTier: 1,
  }),
  cube('block:bricks', 'block.bricks', 'tex:bricks', 2, 'stone', { tool: 'pick', minTier: 1 }),
  cube('block:fire_bricks', 'block.fire_bricks', 'tex:fire_bricks', 2.5, 'stone', {
    tool: 'pick',
    minTier: 1,
  }),
  {
    key: 'block:glowbloom_lantern',
    nameKey: 'block.glowbloom_lantern',
    shape: { boxes: LANTERN },
    pass: 'opaque',
    textures: { all: 'tex:lantern' },
    collision: { boxes: LANTERN },
    opaque: false,
    light: { emit: 13, filter: 1 },
    hardness: 0.5,
    drops: 'self',
    placement: { support: 'below' },
    sound: 'glass',
  },
  {
    key: 'block:workbench',
    nameKey: 'block.workbench',
    shape: 'cube',
    pass: 'opaque',
    textures: { top: 'tex:workbench_top', side: 'tex:workbench_side', bottom: 'tex:planks' },
    collision: 'full',
    opaque: true,
    hardness: 2,
    tool: 'axe',
    drops: 'self',
    blockEntity: 'workbench',
    station: 'station:workbench',
    sound: 'wood',
  },
  {
    key: 'block:campfire',
    nameKey: 'block.campfire',
    shape: { boxes: CAMPFIRE },
    pass: 'opaque',
    textures: { top: 'tex:campfire_top', side: 'tex:log_bark' },
    collision: { boxes: CAMPFIRE },
    opaque: false,
    light: { filter: 1 },
    hardness: 0.8,
    tool: 'axe',
    drops: 'self',
    states: ['lit'],
    whenState: {
      lit: {
        emit: 14,
        heat: { celsius: 25, radius: 4 },
        textures: { top: 'tex:campfire_top_lit' },
      },
    },
    blockEntity: 'station',
    station: 'station:campfire',
    placement: { support: 'below' },
    sound: 'wood',
  },
  {
    key: 'block:bloomery',
    nameKey: 'block.bloomery',
    shape: 'cube',
    pass: 'opaque',
    textures: { side: 'tex:fire_bricks', top: 'tex:bloomery_top', front: 'tex:bloomery_front' },
    collision: 'full',
    opaque: true,
    hardness: 3,
    tool: 'pick',
    minTier: 1,
    drops: 'self',
    states: ['facing4', 'lit'],
    whenState: {
      lit: {
        emit: 13,
        heat: { celsius: 15, radius: 3 },
        textures: { front: 'tex:bloomery_front_lit' },
      },
    },
    blockEntity: 'station',
    station: 'station:bloomery',
    placement: { orient: 'facing' },
    sound: 'stone',
  },
  {
    key: 'block:chest',
    nameKey: 'block.chest',
    shape: { boxes: CHEST },
    pass: 'opaque',
    textures: { top: 'tex:chest_top', side: 'tex:chest_side', front: 'tex:chest_front' },
    collision: { boxes: CHEST },
    opaque: false,
    light: { filter: 1 },
    hardness: 1.5,
    tool: 'axe',
    drops: 'self',
    states: ['facing4'],
    blockEntity: 'container',
    placement: { orient: 'facing' },
    sound: 'wood',
  },
  {
    key: 'block:bedroll',
    nameKey: 'block.bedroll',
    shape: { boxes: BEDROLL },
    pass: 'opaque',
    textures: { all: 'tex:bedroll' },
    collision: 'none',
    opaque: false,
    hardness: 0.5,
    drops: 'self',
    states: ['facing4'],
    blockEntity: 'bed',
    placement: { orient: 'facing', support: 'below' },
    sound: 'cloth',
  },
  {
    key: 'block:abandoned_pack',
    nameKey: 'block.abandoned_pack',
    shape: { boxes: PACK },
    pass: 'opaque',
    textures: { all: 'tex:abandoned_pack' },
    collision: 'none',
    opaque: false,
    hardness: -1,
    drops: 'none',
    blockEntity: 'grave',
    sound: 'cloth',
  },
] as const satisfies readonly PackBlock[];
