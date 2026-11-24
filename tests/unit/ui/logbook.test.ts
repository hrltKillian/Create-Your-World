import { describe, expect, it } from 'vitest';
import {
  batchCount,
  hiddenRecipes,
  type LogbookSource,
  logbookRows,
  pipFilled,
  type RecipeRow,
  stationRecipes,
} from '../../../src/ui/logbook.ts';
import { registry } from '../../helpers/registry.ts';

const MAX = 100;
const crafting = registry.crafting;

/**
 * A player holding `owned` (by item or tag) who has seen those keys and `seen`, at the Logbook of
 * `station` (the Bag's by default), whose queue takes `room` crafts of anything.
 */
function source(
  owned: Record<string, number>,
  seen: readonly string[] = [],
  station?: string,
  room = MAX,
): LogbookSource {
  const seenSet: Record<string, boolean> = {};
  for (const key of [...Object.keys(owned), ...seen]) seenSet[key] = true;
  return {
    crafting,
    ...(station === undefined ? {} : { station }),
    seen: seenSet,
    owned: (ingredient) => owned[ingredient] ?? 0,
    room: () => room,
  };
}

const BENCH = 'station:workbench';
const row = (rows: readonly RecipeRow[], key: string) => rows.find((r) => r.recipe.key === key)!;
const keys = (rows: readonly RecipeRow[]) => rows.map((r) => r.recipe.key);

describe('Logbook', () => {
  it('shows only the recipes known from the start to a new player, in pack order', () => {
    const empty = source({});
    const rows = logbookRows(empty, MAX);
    const start = crafting.recipes.filter((r) => r.known === 'start').map((r) => r.key);
    expect(keys(rows)).toEqual(start);
    expect(rows.every((r) => !r.craftable && r.max === 0)).toBe(true);
    const byHand = crafting.recipes.filter((r) => r.station === undefined);
    expect(hiddenRecipes(empty)).toBe(byHand.length - start.length);
  });

  it('reveals a recipe as soon as one of its ingredients has been seen', () => {
    const before = keys(logbookRows(source({}), MAX));
    expect(before).not.toContain('recipe:stone_shard');
    const after = logbookRows(source({}, ['item:stone']), MAX);
    expect(keys(after)).toContain('recipe:stone_shard');
    expect(hiddenRecipes(source({}, ['item:stone']))).toBeLessThan(hiddenRecipes(source({})));
  });

  it('lists craftable recipes first, keeping pack order inside each group', () => {
    const rows = logbookRows(source({ 'item:flint': 2, 'item:stick': 2, 'item:cord': 1 }), MAX);
    const craftable = rows.filter((r) => r.craftable).map((r) => r.recipe.key);
    expect(craftable).toEqual([
      'recipe:flint_knife',
      'recipe:flint_hatchet',
      'recipe:flint_pickaxe',
    ]);
    expect(keys(rows).slice(0, craftable.length)).toEqual(craftable);
    const rest = keys(rows).slice(craftable.length);
    const packOrder = crafting.recipes.map((r) => r.key).filter((k) => rest.includes(k));
    expect(rest).toEqual(packOrder);
  });

  it('shows owned/required pips, by item or by tag, and the crafts the inventory pays for', () => {
    const rows = logbookRows(source({ 'item:flint': 1, 'item:stick': 7, 'tag:log': 5 }), MAX);
    const hatchet = row(rows, 'recipe:flint_hatchet');
    expect(hatchet.pips).toEqual([
      { key: 'item:flint', owned: 1, required: 1, seen: true },
      { key: 'item:stick', owned: 7, required: 2, seen: true },
      { key: 'item:cord', owned: 0, required: 1, seen: false },
    ]);
    expect(hatchet.pips.map(pipFilled)).toEqual([true, true, false]);
    expect(hatchet.max).toBe(0);
    const planks = row(rows, 'recipe:planks');
    expect(planks.pips[0]).toMatchObject({ key: 'tag:log', owned: 5, seen: true });
    expect(planks.max).toBe(5);
    expect(row(logbookRows(source({ 'tag:log': 500 }), MAX), 'recipe:planks').max).toBe(MAX);
  });

  it("lists the hand recipes in the Bag and a station's at its workbench, counting what is left", () => {
    const items = { 'item:planks': 40, 'item:cord': 5, 'item:stick': 9 };
    const bag = source(items);
    const bagRows = logbookRows(bag, MAX);
    expect(bagRows.every((r) => r.recipe.station === undefined)).toBe(true);
    expect(keys(bagRows)).not.toContain('recipe:chest');
    const atBench = crafting.recipes.filter(
      (r) => r.station === BENCH && crafting.revealed(r, bag.seen),
    );
    expect(stationRecipes(bag)).toEqual([{ station: BENCH, count: atBench.length }]);
    const bench = source(items, [], BENCH);
    const benchRows = logbookRows(bench, MAX);
    expect(keys(benchRows).sort()).toEqual(atBench.map((r) => r.key).sort());
    const chest = row(benchRows, 'recipe:chest');
    expect([chest.max, chest.craftable]).toEqual([5, true]);
    expect(stationRecipes(bench)).toEqual([]);
    expect(hiddenRecipes(bench)).toBe(
      crafting.recipes.filter((r) => r.station === BENCH).length - atBench.length,
    );
  });

  it('turns the ×1, ×5 and Max buttons on only for what can be queued', () => {
    const rows = logbookRows(source({ 'item:plant_fiber': 9 }), MAX);
    const cord = row(rows, 'recipe:cord');
    expect([cord.max, cord.room]).toEqual([3, MAX]);
    expect(batchCount(1, cord)).toBe(1);
    expect(batchCount(5, cord)).toBe(0);
    expect(batchCount('max', cord)).toBe(3);
    const knife = row(rows, 'recipe:flint_knife');
    expect([1, 5, 'max'].map((b) => batchCount(b as 1 | 5 | 'max', knife))).toEqual([0, 0, 0]);
    // The queue's room for the recipe caps every button: Max queues what still fits.
    const plenty = { 'item:plant_fiber': 99 };
    const roomFor = (room: number) =>
      row(logbookRows(source(plenty, [], undefined, room), MAX), 'recipe:cord');
    expect([1, 5, 'max'].map((b) => batchCount(b as 1 | 5 | 'max', roomFor(2)))).toEqual([1, 0, 2]);
    expect([1, 5, 'max'].map((b) => batchCount(b as 1 | 5 | 'max', roomFor(0)))).toEqual([0, 0, 0]);
  });
});
