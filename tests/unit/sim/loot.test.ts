import { describe, expect, it } from 'vitest';
import type { LootTableDef } from '../../../src/content/schema.ts';
import { hash32 } from '../../../src/core/hash.ts';
import { rollLoot } from '../../../src/sim/loot.ts';
import { registry } from '../../helpers/registry.ts';

const ROLLS = 4000;

/** Items given over many seeds: total count per item. */
function tally(table: LootTableDef): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < ROLLS; i++)
    rollLoot(table, hash32(7, i), (item, count) => {
      counts.set(item, (counts.get(item) ?? 0) + count);
    });
  return counts;
}

describe('loot rolls', () => {
  it('draws entries by weight: gravel gives flint about 35 % of the time', () => {
    const counts = tally(registry.loot('loot:gravel')!);
    expect(counts.get('item:flint')! / ROLLS).toBeCloseTo(0.35, 1);
    expect((counts.get('item:flint')! + counts.get('item:gravel')!) / ROLLS).toBe(1);
  });

  it('draws nothing with the empty weight: tall grass gives fibre about 60 % of the time', () => {
    const counts = tally(registry.loot('loot:tall_grass')!);
    expect(counts.get('item:plant_fiber')! / ROLLS).toBeCloseTo(0.6, 1);
  });

  it('stays deterministic per seed, with counts within the entry range', () => {
    const table = registry.loot('loot:camp')!;
    const roll = (seed: number) => {
      const out: [string, number][] = [];
      rollLoot(table, seed, (item, count) => out.push([item, count]));
      return out;
    };
    for (let seed = 0; seed < 50; seed++) {
      const drawn = roll(seed);
      expect(roll(seed)).toEqual(drawn);
      expect(drawn.length).toBeGreaterThanOrEqual(table.rolls[0]);
      expect(drawn.length).toBeLessThanOrEqual(table.rolls[1]);
      for (const [item, count] of drawn) {
        const entry = table.entries.find((e) => e.item === item)!;
        expect(count).toBeGreaterThanOrEqual(entry.count[0]);
        expect(count).toBeLessThanOrEqual(entry.count[1]);
      }
    }
  });
});
