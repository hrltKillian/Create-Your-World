import { describe, expect, it } from 'vitest';
import { packItems } from '../../../src/content/items.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { reachable } from '../../../src/content/reachability.ts';
import type { ContentPack, LootTableDef } from '../../../src/content/schema.ts';

const IRON = 'item:iron_ingot';
const withHostiles = reachable(basePack, { hostiles: true });
const withoutHostiles = reachable(basePack, { hostiles: false });

const keys = <T extends { key: string }>(list: readonly T[] | undefined) =>
  (list ?? []).map((x) => x.key);
const missing = (all: readonly string[], found: ReadonlySet<string>) =>
  all.filter((key) => !found.has(key));

/** A copy of the base pack where no loot table holds these items. */
function lootWithout(...items: string[]): ContentPack {
  const strip = (table: LootTableDef) => ({
    ...table,
    entries: table.entries.filter((e) => !items.includes(e.item)),
  });
  return { ...basePack, loot: basePack.loot!.map(strip) };
}

describe('reachability from the start state (an empty inventory)', () => {
  it('reaches the iron ingot with hostiles enabled and disabled', () => {
    expect(withHostiles.items.has(IRON)).toBe(true);
    expect(withoutHostiles.items.has(IRON)).toBe(true);
  });

  it('reaches every recipe, process and pack item when hostiles are enabled', () => {
    expect(missing(keys(basePack.recipes), withHostiles.recipes)).toEqual([]);
    expect(missing(keys(basePack.processes), withHostiles.processes)).toEqual([]);
    // The unknown item only stands for saved items of another pack.
    expect(missing(keys(basePack.items), withHostiles.items)).toEqual(['item:unknown']);
  });

  it('only loses what hostile creatures alone drop when they are disabled', () => {
    expect(missing([...withHostiles.items], withoutHostiles.items)).toEqual(['item:toxic_gland']);
    expect(missing(keys(basePack.recipes), withoutHostiles.recipes)).toEqual([]);
    // Shagbacks leave sinew too: bronze tools stay within reach.
    for (const tool of ['item:bronze_hatchet', 'item:bronze_pickaxe', 'item:bronze_blade'])
      expect(withoutHostiles.items.has(tool), tool).toBe(true);
  });

  it('needs the Shagback sinew for bronze tools without hostiles, not with them', () => {
    const pack: ContentPack = {
      ...basePack,
      loot: basePack.loot!.map((table) =>
        table.key === 'loot:shagback'
          ? { ...table, entries: table.entries.filter((e) => e.item !== 'item:prowler_sinew') }
          : table,
      ),
    };
    expect(reachable(pack, { hostiles: false }).items.has('item:bronze_pickaxe')).toBe(false);
    expect(reachable(pack, { hostiles: true }).items.has('item:bronze_pickaxe')).toBe(true);
    // The iron path needs copper tools only.
    expect(reachable(pack, { hostiles: false }).items.has(IRON)).toBe(true);
  });

  it('follows tool tiers, stations and fuel rules', () => {
    // Without flint (nor chest ingots for a metal pickaxe), no tool harvests stone: no kiln.
    const metals = ['item:copper_ingot', 'item:bronze_ingot'];
    const flintless = reachable(lootWithout('item:flint', ...metals), { hostiles: true });
    expect(flintless.items.has('item:stone')).toBe(false);
    expect(flintless.items.has('item:kiln')).toBe(false);
    expect(flintless.items.has(IRON)).toBe(false);
    // The bloomery burns charcoal only: without the charcoal process (nor chest charcoal), no iron.
    const charcoalless = reachable(
      {
        ...lootWithout('item:charcoal'),
        processes: basePack.processes!.filter((p) => p.key !== 'process:charcoal'),
      },
      { hostiles: true },
    );
    expect(charcoalless.items.has('item:bloomery')).toBe(true);
    expect(charcoalless.items.has(IRON)).toBe(false);
    // No workbench, no workbench recipe.
    const noBench: ContentPack = {
      ...basePack,
      recipes: basePack.recipes!.filter((r) => r.key !== 'recipe:workbench'),
    };
    const benchless = reachable(noBench, { hostiles: true });
    expect(benchless.recipes.has('recipe:kiln')).toBe(false);
    expect(benchless.items.has(IRON)).toBe(false);
  });

  it('only reports known items', () => {
    const all = new Set(packItems(basePack).map((item) => item.key as string));
    expect(missing([...withHostiles.items], all)).toEqual([]);
  });
});
