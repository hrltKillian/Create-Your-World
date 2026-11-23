import type { LootTableDef } from '../content/schema.ts';
import { hashUnit } from '../core/hash.ts';

/**
 * Rolls a loot table and calls `give` for each item drawn. `seed` must differ per roll (a hash of
 * the world seed, the position and the tick), which keeps drops deterministic without storing a
 * random stream.
 */
export function rollLoot(
  table: LootTableDef,
  seed: number,
  give: (item: string, count: number) => void,
): void {
  const [minRolls, maxRolls] = table.rolls;
  const rolls = minRolls + Math.floor(hashUnit(seed) * (maxRolls - minRolls + 1));
  let total = 0;
  for (const entry of table.entries) total += entry.weight;
  for (let r = 1; r <= rolls; r++) {
    let pick = hashUnit(seed, r, 1) * total;
    let chosen = table.entries[table.entries.length - 1]!;
    for (const entry of table.entries) {
      if (pick < entry.weight) {
        chosen = entry;
        break;
      }
      pick -= entry.weight;
    }
    const [min, max] = chosen.count;
    give(chosen.item, min + Math.floor(hashUnit(seed, r, 2) * (max - min + 1)));
  }
}
