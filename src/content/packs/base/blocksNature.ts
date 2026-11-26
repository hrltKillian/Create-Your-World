import type { BlockDef } from '../../schema.ts';
import { LEAF_DECAY, LOG_ITEM, SAND_ITEM } from './blocks.ts';
import type { PackI18nKey } from './i18n.en.ts';
import { FUELS } from './recipes.ts';

type PackBlock = BlockDef & { readonly nameKey: PackI18nKey };

/** A full opaque cube with one texture, dropping itself. */
export const cube = (
  key: `block:${string}`,
  nameKey: PackI18nKey,
  texture: `tex:${string}`,
  hardness: number,
  sound: BlockDef['sound'],
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
  drops: 'self',
  sound,
  ...extra,
});

/** A cross-shaped plant that needs a block below and that anything placed replaces. */
const plant = (
  key: `block:${string}`,
  nameKey: PackI18nKey,
  texture: `tex:${string}`,
  extra: Partial<PackBlock> = {},
): PackBlock => ({
  key,
  nameKey,
  shape: 'cross',
  pass: 'cutout',
  textures: { all: texture },
  collision: 'none',
  opaque: false,
  replaceable: true,
  hardness: 0,
  drops: 'none',
  placement: { support: 'below' },
  sound: 'leaves',
  ...extra,
});

/** Light a crop needs to ripen: the reference game's. */
const CROP_LIGHT = 9;

/**
 * A crop (plan v3 « M33 », the reference game's sweet berry bush): ripe it bears `harvest` (its
 * `ripe` texture), popped out at its foot by secondary or when broken; broken bare it gives
 * nothing. It is planted from its harvest (`ItemDef.places`) and ripens in 9 light or more. Never
 * replaced by a block placed into it.
 */
const crop = (
  key: `block:${string}`,
  nameKey: PackI18nKey,
  bare: `tex:${string}`,
  ripe: `tex:${string}`,
  harvest: `loot:${string}`,
  seconds: readonly [number, number],
): PackBlock =>
  plant(key, nameKey, bare, {
    states: ['ripe'],
    whenState: { ripe: { textures: { all: ripe } } },
    crop: { harvest, seconds, light: CROP_LIGHT },
    replaceable: false,
  });

/** A tree trunk (plan v3 « M23 »: each species its own bark), a log of the recipes. */
const log = (
  key: `block:${string}`,
  nameKey: PackI18nKey,
  bark: `tex:${string}`,
  rings: `tex:${string}`,
): PackBlock => ({
  key,
  nameKey,
  shape: 'cube',
  pass: 'opaque',
  textures: { side: bark, top: rings },
  collision: 'full',
  opaque: true,
  hardness: 2,
  tool: 'axe',
  drops: 'self',
  states: ['axis'],
  placement: { orient: 'axis' },
  sound: 'wood',
  item: LOG_ITEM,
});

/** A species' leaves, its own colour (no biome tint), falling once no log holds them. */
const leaves = (
  key: `block:${string}`,
  nameKey: PackI18nKey,
  texture: `tex:${string}`,
  drops: `loot:${string}`,
): PackBlock => ({
  key,
  nameKey,
  states: ['placed'],
  decay: LEAF_DECAY,
  shape: 'cube',
  pass: 'cutout',
  cullGroup: 'leaves',
  textures: { all: texture },
  collision: 'full',
  opaque: false,
  light: { filter: 1 },
  hardness: 0.2,
  drops,
  sound: 'leaves',
});

/** Palmthorn trunk: a spiny 12/16 column. */
const PALMTHORN = [[2, 0, 2, 14, 16, 14]] as const;

/** Terrain and vegetation blocks of the surface biomes (M2, decoration M6). */
export const natureBlocks = [
  cube('block:snow', 'block.snow', 'tex:snow', 0.3, 'soil'),
  cube('block:permafrost', 'block.permafrost', 'tex:permafrost', 0.9, 'gravel'),
  {
    key: 'block:ice',
    nameKey: 'block.ice',
    shape: 'cube',
    pass: 'translucent',
    cullGroup: 'ice',
    textures: { all: 'tex:ice' },
    collision: 'full',
    opaque: false,
    light: { filter: 2 },
    friction: 0.2,
    hardness: 0.5,
    drops: 'none',
    sound: 'glass',
  },
  cube('block:ochre_sand', 'block.ochre_sand', 'tex:ochre_sand', 0.5, 'sand', { item: SAND_ITEM }),
  cube('block:ochre_sandstone', 'block.ochre_sandstone', 'tex:ochre_sandstone', 1.2, 'stone', {
    tool: 'pick',
    minTier: 1,
  }),
  cube('block:peat', 'block.peat', 'tex:peat', 0.6, 'soil', {
    item: { fuel: FUELS.peat, hintKey: 'where.peat' },
  }),
  cube('block:silt', 'block.silt', 'tex:silt', 0.5, 'soil'),
  {
    key: 'block:foul_water',
    nameKey: 'block.foul_water',
    states: ['level', 'falling'],
    shape: 'liquid',
    pass: 'translucent',
    cullGroup: 'water',
    textures: { all: 'tex:foul_water' },
    collision: 'liquid',
    opaque: false,
    replaceable: true,
    light: { filter: 2 },
    contact: { toxicityPerMin: 8 },
    hardness: 0,
    drops: 'none',
    sound: 'water',
    liquid: {
      drinkable: true,
      thirstPerSip: 8,
      toxicityPerSip: 10,
      fills: {
        'item:flask_empty': 'item:flask_foul',
        'item:waterskin_empty': 'item:waterskin_foul',
      },
      // Thick and slow, and it never refills itself.
      flow: { seconds: 0.5, holeSearch: 4, infinite: false },
    },
  },
  // The species of Veyra (plan v3 « M23 »), one per biome: the Veilpine (conifer_log, needles)
  // of the Veilwood, the Frostpine of the Rimefrost, the Twistpine of the Shard Highlands, the
  // Mirror Willow of the Mirror Basin and the Podtree of the Sporefen; the Lanternwood
  // (broadleaf_log, foliage) of the Amberfield lies with the base blocks.
  log('block:conifer_log', 'block.conifer_log', 'tex:conifer_bark', 'tex:conifer_rings'),
  leaves('block:needles', 'block.needles', 'tex:needles', 'loot:needles'),
  log('block:frostpine_log', 'block.frostpine_log', 'tex:frostpine_bark', 'tex:frostpine_rings'),
  leaves('block:frost_needles', 'block.frost_needles', 'tex:frost_needles', 'loot:needles'),
  log('block:twistpine_log', 'block.twistpine_log', 'tex:twistpine_bark', 'tex:twistpine_rings'),
  leaves('block:twist_needles', 'block.twist_needles', 'tex:twist_needles', 'loot:needles'),
  log('block:willow_log', 'block.willow_log', 'tex:willow_bark', 'tex:willow_rings'),
  leaves('block:willow_leaves', 'block.willow_leaves', 'tex:willow_leaves', 'loot:foliage'),
  log('block:pod_log', 'block.pod_log', 'tex:pod_bark', 'tex:pod_rings'),
  leaves('block:pod_leaves', 'block.pod_leaves', 'tex:pod_leaves', 'loot:pod_leaves'),
  // Plants of Veyra (plan v3 « M23 »), none for nothing (« M30 »): the grass kin give fibre like
  // the tall grass, the shrubs sticks, the others their own harvest.
  plant('block:frost_lichen', 'block.frost_lichen', 'tex:frost_lichen', {
    drops: 'loot:tall_grass',
  }),
  plant('block:amber_bell', 'block.amber_bell', 'tex:amber_bell', { drops: 'loot:tall_grass' }),
  plant('block:veil_fern', 'block.veil_fern', 'tex:veil_fern', { drops: 'loot:tall_grass' }),
  plant('block:cap_sprout', 'block.cap_sprout', 'tex:cap_sprout', {
    light: { emit: 3 },
    drops: 'loot:tall_grass',
  }),
  plant('block:reed', 'block.reed', 'tex:reed', { drops: 'loot:tall_grass' }),
  // Crops (plan v3 « M33 »): picked bare, they ripen again in a few minutes; planted from their
  // harvest.
  crop(
    'block:frost_bulb',
    'block.frost_bulb',
    'tex:frost_bulb_bare',
    'tex:frost_bulb',
    'loot:frost_bulb',
    [300, 480],
  ),
  plant('block:crystal_sprout', 'block.crystal_sprout', 'tex:crystal_sprout', {
    light: { emit: 4 },
    drops: 'loot:crystal_sprout',
  }),
  plant('block:dry_shrub', 'block.dry_shrub', 'tex:dry_shrub', { drops: 'loot:dry_shrub' }),
  crop(
    'block:berry_bush',
    'block.berry_bush',
    'tex:berry_bush_bare',
    'tex:berry_bush',
    'loot:berry_bush',
    [240, 420],
  ),
  plant('block:thornbush', 'block.thornbush', 'tex:thornbush', {
    contact: { damagePerSec: 1 },
    drops: 'loot:dry_shrub',
  }),
  plant('block:glowbloom', 'block.glowbloom', 'tex:glowbloom', {
    light: { emit: 5 },
    drops: 'self',
    item: { hintKey: 'where.glowbloom' },
  }),
  {
    key: 'block:palmthorn',
    nameKey: 'block.palmthorn',
    shape: { boxes: PALMTHORN },
    pass: 'opaque',
    textures: { side: 'tex:palmthorn', top: 'tex:palmthorn_top' },
    collision: { boxes: PALMTHORN },
    opaque: false,
    light: { filter: 1 },
    contact: { damagePerSec: 1 },
    hardness: 0.4,
    // A crop of the Ochre Waste (plan v3 « M33 »): its fruit ripens on its sides, popped out
    // when picked; broken, it gives itself (the reference game's cactus) and its ripe fruit.
    states: ['ripe'],
    whenState: { ripe: { textures: { side: 'tex:palmthorn_ripe' } } },
    crop: { harvest: 'loot:palmthorn', seconds: [360, 600], light: CROP_LIGHT },
    drops: 'self',
    placement: { support: 'below' },
    sound: 'wood',
  },
  // The Capwood's giant mushrooms are trees (plan v3 « M23 »): the stem is a log, the cap falls
  // once no stem holds it.
  {
    key: 'block:mushroom_stem',
    nameKey: 'block.mushroom_stem',
    shape: 'cube',
    pass: 'opaque',
    textures: { side: 'tex:mushroom_stem', top: 'tex:mushroom_stem_top' },
    collision: 'full',
    opaque: true,
    hardness: 1,
    tool: 'axe',
    drops: 'self',
    sound: 'wood',
    item: LOG_ITEM,
  },
  cube('block:glowcap', 'block.glowcap', 'tex:glowcap', 0.4, 'leaves', {
    states: ['placed'],
    decay: { anchors: ['block:mushroom_stem'], radius: 7, seconds: [2, 12] },
    light: { emit: 6 },
    tool: 'axe',
    item: { hintKey: 'where.glowcap' },
  }),
] as const satisfies readonly PackBlock[];
