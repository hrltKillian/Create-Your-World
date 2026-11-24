import type { LootTableDef } from '../content/schema.ts';
import { hashUnit } from '../core/hash.ts';

/**
 * Rolls a loot table and calls `give` for each item drawn. `seed` must differ per roll (a hash of
 * the world seed, the position and the tick), which keeps drops deterministic without storing a
 * random stream. A roll draws nothing with the table's `empty` weight, and never an entry drawn
 * before (`drawn` is a bit mask: validation keeps tables within 31 entries).
 */
export function rollLoot(
  table: LootTableDef,
  seed: number,
  give: (item: string, count: number) => void,
): void {
  const entries = table.entries;
  const [minRolls, maxRolls] = table.rolls;
  const rolls = minRolls + Math.floor(hashUnit(seed) * (maxRolls - minRolls + 1));
  let left = 0;
  for (const entry of entries) left += entry.weight;
  let drawn = 0;
  for (let r = 1; r <= rolls; r++) {
    let pick = hashUnit(seed, r, 1) * (left + (table.empty ?? 0));
    let chosen = -1;
    let last = -1;
    for (let e = 0; e < entries.length; e++) {
      if (drawn & (1 << e)) continue;
      last = e;
      if (pick < entries[e]!.weight) {
        chosen = e;
        break;
      }
      pick -= entries[e]!.weight;
    }
    // Past every entry lies the empty share; without one, rounding falls on the last entry left.
    if (chosen < 0 && !table.empty) chosen = last;
    if (chosen < 0) continue;
    const entry = entries[chosen]!;
    drawn |= 1 << chosen;
    left -= entry.weight;
    const [min, max] = entry.count;
    give(entry.item, min + Math.floor(hashUnit(seed, r, 2) * (max - min + 1)));
  }
}
