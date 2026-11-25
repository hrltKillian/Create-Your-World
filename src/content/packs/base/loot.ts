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
    // Fishing (plan v3 « M33 »): fresh water gives a fish half the time, else what drifts in it.
    key: 'loot:fish',
    rolls: [1, 1],
    entries: [
      { item: 'item:raw_fish', count: [1, 1], weight: 4 },
      { item: 'item:stick', count: [1, 2], weight: 2 },
      { item: 'item:plant_fiber', count: [1, 2], weight: 2 },
    ],
  },
  {
    // The Mirror Basin's lakes: fish nearly always, now and then two, or a lump of its clay.
    key: 'loot:fish_basin',
    rolls: [1, 1],
    entries: [
      { item: 'item:raw_fish', count: [1, 2], weight: 9 },
      { item: 'item:clay_lump', count: [1, 2], weight: 1 },
    ],
  },
  {
    key: 'loot:berry_bush',
    rolls: [1, 1],
    entries: [{ item: 'item:berries', count: [1, 3], weight: 1 }],
  },
  {
    // The Sporefen's podtrees: sticks, and now and then a pod of resin.
    key: 'loot:pod_leaves',
    rolls: [1, 1],
    entries: [
      { item: 'item:stick', count: [1, 1], weight: 2 },
      { item: 'item:resin', count: [1, 1], weight: 1 },
    ],
    empty: 3,
  },
  {
    key: 'loot:frost_bulb',
    rolls: [1, 1],
    entries: [{ item: 'item:ice_bulb', count: [1, 2], weight: 1 }],
  },
  {
    key: 'loot:crystal_sprout',
    rolls: [1, 1],
    entries: [{ item: 'item:crystal_shard', count: [1, 1], weight: 1 }],
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
    key: 'loot:glimmerback',
    rolls: [2, 2],
    entries: [
      { item: 'item:raw_meat', count: [1, 2], weight: 2 },
      { item: 'item:raw_hide', count: [1, 1], weight: 1 },
    ],
  },
  {
    key: 'loot:reedwader',
    rolls: [1, 2],
    entries: [
      { item: 'item:raw_meat', count: [1, 1], weight: 2 },
      { item: 'item:plant_fiber', count: [1, 2], weight: 1 },
    ],
  },
  {
    key: 'loot:shagback',
    rolls: [2, 2],
    // Sinew too: bronze tools stay within reach in worlds without hostiles (no structures yet).
    entries: [
      { item: 'item:fur', count: [1, 2], weight: 2 },
      { item: 'item:prowler_sinew', count: [1, 1], weight: 1 },
    ],
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
