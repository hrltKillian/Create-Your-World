import type { LootTableDef } from '../../schema.ts';

/** Loot tables of block drops. */
export const loot = [
  // Breaking turf yields the soil under it.
  { key: 'loot:grass', rolls: [1, 1], entries: [{ item: 'item:dirt', count: [1, 1], weight: 1 }] },
] as const satisfies readonly LootTableDef[];
