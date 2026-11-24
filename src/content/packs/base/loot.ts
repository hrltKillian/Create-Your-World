import type { LootTableDef } from '../../schema.ts';

/**
 * Loot tables: block drops, structure chests and creatures. Each roll draws one entry not drawn
 * yet by weight, or nothing with the `empty` weight.
 */
export const loot = [
  // Breaking turf yields the soil under it.
  { key: 'loot:grass', rolls: [1, 1], entries: [{ item: 'item:dirt', count: [1, 1], weight: 1 }] },
  {
    key: 'loot:gravel',
    rolls: [1, 1],
    entries: [
      { item: 'item:flint', count: [1, 1], weight: 35 },
      { item: 'item:gravel', count: [1, 1], weight: 65 },
    ],
  },
  {
    key: 'loot:tall_grass',
    rolls: [1, 1],
    entries: [{ item: 'item:plant_fiber', count: [1, 1], weight: 60 }],
    empty: 40,
  },
  {
    key: 'loot:clay',
    rolls: [1, 1],
    entries: [{ item: 'item:clay_lump', count: [2, 4], weight: 1 }],
  },
  {
    key: 'loot:foliage',
    rolls: [1, 1],
    entries: [{ item: 'item:stick', count: [1, 1], weight: 1 }],
    empty: 1,
  },
  {
    key: 'loot:needles',
    rolls: [1, 1],
    entries: [
      { item: 'item:stick', count: [1, 1], weight: 2 },
      { item: 'item:resin', count: [1, 1], weight: 1 },
    ],
    empty: 2,
  },
  {
    key: 'loot:dry_shrub',
    rolls: [1, 1],
    entries: [{ item: 'item:stick', count: [1, 2], weight: 1 }],
  },
  {
    key: 'loot:berry_bush',
    rolls: [1, 1],
    entries: [{ item: 'item:berries', count: [1, 3], weight: 1 }],
  },
  {
    key: 'loot:palmthorn',
    rolls: [1, 1],
    entries: [
      { item: 'item:palmthorn_fruit', count: [1, 2], weight: 2 },
      { item: 'item:resin', count: [1, 1], weight: 1 },
    ],
  },
  {
    key: 'loot:dawn_crystal',
    rolls: [1, 1],
    entries: [{ item: 'item:crystal_shard', count: [1, 2], weight: 1 }],
  },
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
  // Creatures (docs « Créatures et combat », Butin): a Trotter always leaves meat and hide.
  {
    key: 'loot:trotter',
    rolls: [2, 2],
    entries: [
      { item: 'item:raw_meat', count: [1, 2], weight: 1 },
      { item: 'item:raw_hide', count: [1, 1], weight: 1 },
    ],
  },
  {
    key: 'loot:shagback',
    rolls: [1, 1],
    entries: [{ item: 'item:fur', count: [1, 2], weight: 1 }],
  },
  {
    key: 'loot:prowler',
    rolls: [1, 1],
    entries: [{ item: 'item:prowler_sinew', count: [1, 1], weight: 1 }],
  },
  {
    key: 'loot:swarmling',
    rolls: [1, 1],
    entries: [{ item: 'item:toxic_gland', count: [1, 1], weight: 1 }],
    empty: 1,
  },
  {
    key: 'loot:shellback',
    rolls: [1, 1],
    entries: [{ item: 'item:shell_plate', count: [1, 2], weight: 1 }],
  },
] as const satisfies readonly LootTableDef[];
