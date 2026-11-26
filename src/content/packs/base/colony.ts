import type { BlockDef, LootTableDef, StructureDef, TextureDef } from '../../schema.ts';
import { cube } from './blocksNature.ts';
import type { PackI18nKey } from './i18n.en.ts';

/*
 * The lost colony (plan v3 « M26 », the theme bible's story): its blocks, the story sites the world
 * places around the spawn (the crash site of the player's capsule, the colony's outpost, the north
 * relay in the Rimefrost and the marsh station in the Sporefen) and the ruins scattered at random,
 * with what their chests keep: the capsule's parts, the colonists' journals and blueprints.
 */

type PackBlock = BlockDef & { readonly nameKey: PackI18nKey };

/** Blocks of the colony: the capsule's hull, the outpost's bricks, and the lamp a blueprint teaches. */
export const colonyBlocks = [
  cube('block:hull_plate', 'block.hull_plate', 'tex:hull_plate', 3, 'stone', {
    tool: 'pick',
    minTier: 1,
  }),
  cube('block:colony_brick', 'block.colony_brick', 'tex:colony_brick', 2, 'stone', {
    tool: 'pick',
  }),
  cube('block:colony_lamp', 'block.colony_lamp', 'tex:colony_lamp', 1, 'glass', {
    light: { emit: 14 },
  }),
] as const satisfies readonly PackBlock[];

export const colonyTextures = [
  {
    key: 'tex:hull_plate',
    pattern: 'cutStone',
    palette: ['#4b5560', '#5a6570', '#6a7580', '#7b8690'],
    seed: 441,
  },
  {
    key: 'tex:colony_brick',
    pattern: 'bricks',
    palette: ['#4a4438', '#8c8068', '#9c907a', '#aca08a'],
    seed: 443,
  },
  {
    key: 'tex:colony_lamp',
    pattern: 'ore',
    palette: ['#3a3f44', '#4a5056', '#5a6168', '#ffd27a', '#fff3c8'],
    seed: 445,
    alpha: 'emissiveMask',
  },
] as const satisfies readonly TextureDef[];

/** What the colony's chests keep: each table's entries drawn once each (fixed contents). */
export const colonyLoot = [
  {
    key: 'loot:salvage_locker',
    rolls: [3, 3],
    entries: [
      { item: 'item:capsule_parts', count: [1, 1], weight: 1 },
      { item: 'item:journal_crash', count: [1, 1], weight: 1 },
      { item: 'item:flint', count: [2, 3], weight: 1 },
    ],
  },
  {
    key: 'loot:outpost',
    rolls: [3, 3],
    entries: [
      { item: 'item:journal_outpost', count: [1, 1], weight: 1 },
      { item: 'item:blueprint_lamp', count: [1, 1], weight: 1 },
      { item: 'item:copper_ingot', count: [1, 2], weight: 1 },
    ],
  },
  {
    key: 'loot:relay',
    rolls: [3, 3],
    entries: [
      { item: 'item:journal_relay', count: [1, 1], weight: 1 },
      { item: 'item:blueprint_brick', count: [1, 1], weight: 1 },
      { item: 'item:fur', count: [2, 3], weight: 1 },
    ],
  },
  {
    key: 'loot:station',
    rolls: [3, 3],
    entries: [
      { item: 'item:journal_station', count: [1, 1], weight: 1 },
      { item: 'item:charcoal', count: [2, 4], weight: 1 },
      { item: 'item:bandage', count: [1, 2], weight: 1 },
    ],
  },
  {
    key: 'loot:ruin',
    rolls: [1, 2],
    entries: [
      { item: 'item:journal_ruin', count: [1, 1], weight: 2 },
      { item: 'item:cord', count: [1, 3], weight: 2 },
      { item: 'item:copper_ingot', count: [1, 1], weight: 1 },
    ],
    empty: 1,
  },
] as const satisfies readonly LootTableDef[];

const CHEST = 'block:chest[facing4=s]';
const LAND = [
  'biome:meadow',
  'biome:forest',
  'biome:capwood',
  'biome:highlands',
  'biome:lake_basin',
  'biome:tundra',
  'biome:ochre_desert',
  'biome:fungal_marsh',
] as const;

/** The story sites (once per world, from the spawn) and the random ruins. */
export const colonyStructures = [
  {
    // The player's capsule, half buried by the fall, its salvage locker inside.
    key: 'structure:crash_site',
    biomes: LAND,
    chance: 0,
    place: { distance: [14, 48] },
    layers: [
      ['.HHHHH.', 'HHHHHHH', 'HHHHHHH', '.HHHHH.'],
      ['.H...H.', 'H.L...H', 'H.....W', '.HH.HH.'],
      ['..HHH..', '.H...H.', '.H...H.', '..H.H..'],
      ['.......', '..HHH..', '..HHH..', '.......'],
    ],
    legend: { H: 'block:hull_plate', W: 'block:glass', L: CHEST },
    lootTables: { L: 'loot:salvage_locker' },
  },
  {
    // The colony's outpost: brick walls fallen in places around a plank floor.
    key: 'structure:outpost',
    biomes: ['biome:meadow', 'biome:forest', 'biome:capwood', 'biome:highlands'],
    chance: 0,
    place: { distance: [120, 250] },
    layers: [
      [
        'BBBBBBBBB',
        'BPPPPPPPB',
        'BPPPPPPPB',
        'BPPPPPPPB',
        'BPPPPPPPB',
        'BPPPPPPPB',
        'BPPPPPPPB',
        'BPPPPPPPB',
        'BBBBBBBBB',
      ],
      [
        'BBBBBBBBB',
        'B.......B',
        'B.C.....B',
        'B.......B',
        'B.......B',
        'B.......B',
        'B.......B',
        'B.......B',
        'BBBB.BBBB',
      ],
      [
        'BBB.BBB.B',
        'B.......B',
        '........B',
        'B.......B',
        'B........',
        'B.......B',
        'B.......B',
        'B.......B',
        'BB....BBB',
      ],
      [
        'B.B...B..',
        '.........',
        '.........',
        'B........',
        '.........',
        '.........',
        'B.......B',
        '.........',
        'B......B.',
      ],
    ],
    legend: { B: 'block:colony_brick', P: 'block:planks', C: CHEST },
    lootTables: { C: 'loot:outpost' },
  },
  {
    // The north relay: a hull tower in the Rimefrost, a lamp under its roof, an antenna on top.
    key: 'structure:north_relay',
    biomes: ['biome:tundra'],
    chance: 0,
    place: { distance: [0, 1200] },
    layers: [
      ['BBBBB', 'BPPPB', 'BPPPB', 'BPPPB', 'BBBBB'],
      ['BHHHB', 'H.C.H', 'H...H', 'H...H', 'BH.HB'],
      ['BHHHB', 'H...H', 'W...W', 'H...H', 'BHHHB'],
      ['BHWHB', 'H...H', 'H...H', 'H...H', 'BHHHB'],
      ['BBBBB', 'BHHHB', 'BHLHB', 'BHHHB', 'BBBBB'],
      ['.....', '.....', '..H..', '.....', '.....'],
    ],
    legend: {
      B: 'block:colony_brick',
      H: 'block:hull_plate',
      P: 'block:planks',
      W: 'block:glass',
      L: 'block:colony_lamp',
      C: CHEST,
    },
    lootTables: { C: 'loot:relay' },
  },
  {
    // The marsh station: a plank hut on its platform above the Sporefen's mud.
    key: 'structure:marsh_station',
    biomes: ['biome:fungal_marsh'],
    chance: 0,
    place: { distance: [0, 1200] },
    layers: [
      ['PPPPPPP', 'PPPPPPP', 'PPPPPPP', 'PPPPPPP', 'PPPPPPP', 'PPPPPPP', 'PPPPPPP'],
      ['PPPPPPP', 'P.....P', 'P.C...W', 'P.....P', 'W.....P', 'P.....P', 'PPP.PPP'],
      ['PPPPPPP', 'P.....P', 'P.....P', 'W.....W', 'P.....P', 'P.....P', 'PPPPPPP'],
      ['HHHHHHH', 'HHHHHHH', 'HHHHHHH', 'HHHHHHH', 'HHHHHHH', 'HHHHHHH', 'HHHHHHH'],
    ],
    legend: { P: 'block:planks', W: 'block:glass', H: 'block:hull_plate', C: CHEST },
    lootTables: { C: 'loot:station' },
  },
  {
    // Ruins of the colony anywhere on dry land: broken brick walls and, now and then, a chest.
    key: 'structure:ruin',
    biomes: LAND,
    chance: 0.06,
    layers: [
      ['BB.BB', 'B...B', '.....', 'B...B', 'BB.BB'],
      ['B..B.', 'B.C..', '.....', '....B', '.B..B'],
      ['B....', '.....', '.....', '.....', '....B'],
    ],
    legend: { B: 'block:colony_brick', C: CHEST },
    lootTables: { C: 'loot:ruin' },
  },
] as const satisfies readonly StructureDef[];
