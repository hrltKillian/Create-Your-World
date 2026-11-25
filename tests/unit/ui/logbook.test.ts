import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { addStrings } from '../../../src/i18n/i18n.ts';
import { ingredientName } from '../../../src/ui/itemSlot.ts';
import {
  batchCount,
  filterRows,
  type LogbookSource,
  logbookRows,
  pipFilled,
  type RecipeRow,
  searchKey,
  stationRecipes,
} from '../../../src/ui/logbook.ts';
import { registry } from '../../helpers/registry.ts';

addStrings(basePack.strings);

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
const discovered = (rows: readonly RecipeRow[]) => keys(rows.filter((r) => r.discovered));

describe('Logbook', () => {
  it('shows a new player the recipes known from the start, then the others undiscovered', () => {
    const rows = logbookRows(source({}), MAX);
    const byHand = crafting.recipes.filter((r) => r.station === undefined);
    const start = byHand.filter((r) => r.known === 'start').map((r) => r.key);
    // Every hand recipe, in pack order: the known ones first, the undiscovered ones at the bottom.
    expect(keys(rows)).toEqual([
      ...start,
      ...byHand.map((r) => r.key).filter((key) => !start.includes(key)),
    ]);
    expect(discovered(rows)).toEqual(start);
    expect(rows.every((r) => !r.craftable && r.max === 0)).toBe(true);
  });

  it('reveals a recipe as soon as one of its ingredients has been seen', () => {
    const before = row(logbookRows(source({}), MAX), 'recipe:stone_shard');
    expect(before.discovered).toBe(false);
    expect(before.pips.every((pip) => !pip.seen)).toBe(true);
    const after = logbookRows(source({}, ['item:stone']), MAX);
    expect(row(after, 'recipe:stone_shard').discovered).toBe(true);
    expect(discovered(after)).toContain('recipe:stone_shard');
  });

  it('never makes an undiscovered recipe craftable, and lists it after every revealed one', () => {
    // A recipe whose ingredients are owned but unseen (as before the tick that notes them).
    const unseen: LogbookSource = { ...source({}), owned: () => 50 };
    const rows = logbookRows(unseen, MAX);
    const shard = row(rows, 'recipe:stone_shard');
    expect([shard.discovered, shard.max, shard.craftable]).toEqual([false, 0, false]);
    expect(batchCount('max', shard)).toBe(0);
    const firstHidden = rows.findIndex((r) => !r.discovered);
    expect(rows.slice(firstHidden).every((r) => !r.discovered)).toBe(true);
    expect(rows.slice(0, firstHidden).every((r) => r.craftable)).toBe(true);
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
    // Then the other revealed ones, then the undiscovered ones, each in pack order.
    const inPackOrder = (group: readonly string[]) =>
      crafting.recipes.map((r) => r.key).filter((k) => group.includes(k));
    const known = discovered(rows).slice(craftable.length);
    const hidden = keys(rows.filter((r) => !r.discovered));
    expect(keys(rows)).toEqual([...craftable, ...known, ...hidden]);
    expect(known).toEqual(inPackOrder(known));
    expect(hidden).toEqual(inPackOrder(hidden));
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
    expect(discovered(benchRows).sort()).toEqual(atBench.map((r) => r.key).sort());
    const chest = row(benchRows, 'recipe:chest');
    expect([chest.max, chest.craftable]).toEqual([5, true]);
    expect(stationRecipes(bench)).toEqual([]);
    // Every bench recipe is listed at the bench: the revealed ones, then the others greyed.
    const allBench = crafting.recipes.filter((r) => r.station === BENCH);
    expect(keys(logbookRows(bench, MAX)).sort()).toEqual(allBench.map((r) => r.key).sort());
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

  describe('search and filter', () => {
    const name = (key: string) => ingredientName(registry, key);
    const tools = { 'item:flint': 2, 'item:stick': 2, 'item:cord': 1 };
    const rows = logbookRows(source(tools), MAX);
    const kept = (query: string, craftableOnly = false) =>
      keys(filterRows(rows, { query, craftableOnly }, name));

    it('compares without case, accents or surrounding spaces', () => {
      expect(searchKey('  Écorce Brûlée ')).toBe('ecorce brulee');
      expect(searchKey('ÇA')).toBe(searchKey('ca'));
      // A name with accents (a translation) is found typed without them, and the other way round.
      const accented = (key: string) => (key === 'item:cord' ? 'Cordée' : name(key));
      const found = (query: string) =>
        keys(filterRows(rows, { query, craftableOnly: false }, accented));
      expect(found('CORDEE')).toEqual(found('cordée'));
      expect(found('cordee')).toContain('recipe:cord');
    });

    it("keeps the rows whose output or a shown ingredient's name holds the query, in order", () => {
      expect(kept('')).toEqual(keys(rows));
      expect(kept('hatchet')).toEqual(['recipe:flint_hatchet']);
      // By an ingredient: every recipe that takes flint, craftable ones first as listed.
      const flint = kept('FLINT');
      expect(flint).toEqual(
        keys(rows).filter((key) =>
          row(rows, key).recipe.inputs.some((input) => input.item === 'item:flint'),
        ),
      );
      expect(flint.slice(0, 3)).toEqual([
        'recipe:flint_knife',
        'recipe:flint_hatchet',
        'recipe:flint_pickaxe',
      ]);
      // A tag is searched by its name (« Any Log »).
      expect(kept('any log')).toContain('recipe:planks');
      expect(kept('no such thing')).toEqual([]);
    });

    it('finds an undiscovered recipe by its output, never by its unseen ingredients', () => {
      const bandage = row(rows, 'recipe:bandage');
      expect(bandage.discovered).toBe(false);
      expect(kept('bandage')).toEqual(['recipe:bandage']);
      // Its resin is unseen: « ? » on screen, so the recipe is not found by it (the scanner, known
      // from the start, names all of its ingredients).
      expect(kept('resin')).toEqual(['recipe:scanner']);
      const seen = logbookRows(source(tools, ['item:resin']), MAX);
      const keptSeen = keys(filterRows(seen, { query: 'resin', craftableOnly: false }, name));
      expect(keptSeen).toEqual(['recipe:scanner', 'recipe:bandage']);
    });

    it('« Can craft now » keeps only what the inventory pays for, never an undiscovered recipe', () => {
      expect(kept('', true)).toEqual(keys(rows.filter((r) => r.craftable)));
      expect(kept('', true)).toEqual([
        'recipe:flint_knife',
        'recipe:flint_hatchet',
        'recipe:flint_pickaxe',
      ]);
      expect(kept('pickaxe', true)).toEqual(['recipe:flint_pickaxe']);
      expect(kept('shard', true)).toEqual([]);
    });
  });
});
