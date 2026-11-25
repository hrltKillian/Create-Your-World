import { basePack } from '../../src/content/packs/base/index.ts';
import { buildRegistry } from '../../src/content/registry.ts';
import type { ContentPack, LootTableDef, StructureDef } from '../../src/content/schema.ts';

/*
 * The structures the base pack had until plan v3 (an abandoned camp and a cairn): the base pack
 * generates none until the lost colony's (plan v3 « M26 »), so the structure engine is tested on
 * this pack (the base pack plus these templates and their loot).
 */

export const structures = [
  {
    // A lean-to with a broken roof, a crate under it, a fire pit and a bench.
    key: 'structure:camp',
    biomes: ['biome:meadow', 'biome:forest', 'biome:ochre_desert'],
    chance: 0.15,
    layers: [
      [
        '...........',
        '.PPPPP.....',
        '.PPPPP.....',
        '.PPPPP.DDD.',
        '...DDDDDGD.',
        '.......DDD.',
        '.......DDD.',
        '...........',
        '...........',
      ],
      [
        '...........',
        '.LPPPL.....',
        '.C.........',
        '.L...L..S..',
        '.......S.S.',
        '........S..',
        '.......lll.',
        '...........',
        '.lll.......',
      ],
      [
        '...........',
        '.LP.PL.....',
        '...........',
        '.L...L.....',
        '...........',
        '...........',
        '...........',
        '...........',
        '...........',
      ],
      [
        '...........',
        '.PPPPP.....',
        '.PP.PP.....',
        '.PPPP......',
        '...........',
        '...........',
        '...........',
        '...........',
        '...........',
      ],
    ],
    legend: {
      P: 'block:planks',
      L: 'block:broadleaf_log[axis=y]',
      l: 'block:broadleaf_log[axis=x]',
      D: 'block:dirt',
      G: 'block:gravel',
      S: 'block:stone',
      C: 'block:chest[facing4=e]',
    },
    lootTables: { C: 'loot:camp' },
  },
  {
    // A pile of stones on a gravel bed, a chest buried in its heart.
    key: 'structure:cairn',
    biomes: ['biome:tundra', 'biome:highlands', 'biome:fungal_marsh'],
    chance: 0.1,
    layers: [
      ['.......', '..GGG..', '.GSSSG.', '.GSSSG.', '.GSSSG.', '..GGG..', '.......'],
      ['.......', '...S...', '..SSS..', '.SSCSS.', '..SSS..', '...S...', '.......'],
      ['.......', '.......', '...S...', '..SSS..', '...S...', '.......', '.......'],
      ['.......', '.......', '.......', '...S...', '.......', '.......', '.......'],
      ['.......', '.......', '.......', '...S...', '.......', '.......', '.......'],
    ],
    legend: {
      S: 'block:stone',
      G: 'block:gravel',
      C: 'block:chest[facing4=s]',
    },
    lootTables: { C: 'loot:cairn' },
  },
] as const satisfies readonly StructureDef[];

/** The loot of their chests. */
export const structureLoot = [
  // An abandoned camp: early supplies, a little leather and copper.
  {
    key: 'loot:camp',
    rolls: [3, 5],
    entries: [
      { item: 'item:stick', count: [2, 6], weight: 4 },
      { item: 'item:cord', count: [1, 3], weight: 3 },
      { item: 'item:flint', count: [1, 3], weight: 3 },
      { item: 'item:berries', count: [2, 5], weight: 3 },
      { item: 'item:torch', count: [2, 4], weight: 2 },
      { item: 'item:clay_lump', count: [2, 4], weight: 2 },
      { item: 'item:raw_hide', count: [1, 2], weight: 2 },
      { item: 'item:resin', count: [1, 2], weight: 2 },
      { item: 'item:leather', count: [1, 1], weight: 1 },
      { item: 'item:copper_ingot', count: [1, 2], weight: 1 },
    ],
  },
  // A cairn: Prowler Sinew (bronze tools stay reachable in worlds without hostiles), fur, metal.
  {
    key: 'loot:cairn',
    rolls: [3, 4],
    entries: [
      { item: 'item:prowler_sinew', count: [1, 2], weight: 4 },
      { item: 'item:fur', count: [1, 2], weight: 2 },
      { item: 'item:charcoal', count: [1, 3], weight: 2 },
      { item: 'item:leather', count: [1, 2], weight: 2 },
      { item: 'item:copper_ingot', count: [1, 2], weight: 2 },
      { item: 'item:bronze_ingot', count: [1, 1], weight: 1 },
      { item: 'item:crystal_shard', count: [1, 2], weight: 1 },
    ],
  },
] as const satisfies readonly LootTableDef[];

/** The base pack with the camp and the cairn. */
export const structurePack: ContentPack = {
  ...basePack,
  structures,
  loot: [...(basePack.loot ?? []), ...structureLoot],
};

export const structureRegistry = buildRegistry(structurePack);
