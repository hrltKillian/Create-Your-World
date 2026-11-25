import { describe, expect, it } from 'vitest';
import { DEFAULT_STACK } from '../../../src/content/items.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';
import type { ContentPack, Ingredient } from '../../../src/content/schema.ts';
import { validatePack } from '../../../src/content/validate.ts';
import { registry } from '../../helpers/registry.ts';

const crafting = registry.crafting;
const recipe = (id: string) => crafting.recipe(`recipe:${id}`)!;
const process = (id: string) => crafting.process(`process:${id}`)!;
const pairs = (inputs: readonly Ingredient[]) => inputs.map((i) => [i.item, i.count]);

function broken(mutate: (pack: Record<string, Record<string, unknown>[]>) => void): ContentPack {
  const pack = JSON.parse(JSON.stringify(basePack));
  mutate(pack);
  return pack as ContentPack;
}

describe('crafting index', () => {
  it('finds recipes, processes and stations by key, and the processes of a station', () => {
    expect(recipe('flint_hatchet').output).toEqual({ item: 'item:flint_hatchet', count: 1 });
    expect(crafting.recipe('recipe:nope')).toBeUndefined();
    expect(crafting.station('station:kiln')?.burns).toBe(true);
    const kiln = crafting.processesOf('station:kiln').map((p) => p.key);
    expect(kiln).toContain('process:bronze_ingot');
    expect(kiln).not.toContain('process:iron_ingot');
    expect(crafting.processesOf('station:workbench')).toEqual([]);
  });

  it('matches an ingredient by item key or by tag', () => {
    expect(crafting.matches('item:broadleaf_log', 'tag:log')).toBe(true);
    expect(crafting.matches('item:conifer_log', 'tag:log')).toBe(true);
    expect(crafting.matches('item:planks', 'tag:log')).toBe(false);
    expect(crafting.matches('item:ochre_sand', 'tag:sand')).toBe(true);
    expect(crafting.matches('item:flint', 'item:flint')).toBe(true);
    expect(crafting.matches('item:nope', 'tag:log')).toBe(false);
  });

  it('burns fuels for their seconds; charcoal-only processes take charcoal alone', () => {
    const burn = (item: string) => crafting.burnSeconds(item, 'any');
    expect(
      ['stick', 'planks', 'broadleaf_log', 'peat', 'charcoal'].map((id) => burn(`item:${id}`)),
    ).toEqual([5, 15, 40, 60, 80]);
    expect(burn('item:flint')).toBe(0);
    expect(crafting.burnSeconds('item:charcoal', 'charcoal')).toBe(80);
    expect(crafting.burnSeconds('item:broadleaf_log', 'charcoal')).toBe(0);
    expect(crafting.burnSeconds('item:charcoal', 'none')).toBe(0);
  });
});

describe('base pack crafting data (docs « Craft », « Stations », « Progression »)', () => {
  it('times hand recipes at 1–3 s (Flint Hatchet 2 s); start recipes are made by hand', () => {
    for (const r of crafting.recipes.filter((r) => r.station === undefined)) {
      expect(r.seconds, r.key).toBeGreaterThanOrEqual(1);
      expect(r.seconds, r.key).toBeLessThanOrEqual(3);
    }
    expect(recipe('flint_hatchet').seconds).toBe(2);
    const start = crafting.recipes.filter((r) => r.known === 'start');
    expect(start.every((r) => r.station === undefined)).toBe(true);
    expect(start.map((r) => r.output.item)).toEqual(
      expect.arrayContaining([
        'item:cord',
        'item:flint_hatchet',
        'item:flint_pickaxe',
        'item:torch',
        'item:campfire',
        'item:planks',
        'item:unfired_flask',
        'item:workbench',
      ]),
    );
  });

  it('builds the stations from their documented ingredients', () => {
    expect(pairs(recipe('workbench').inputs)).toEqual([
      ['item:planks', 8],
      ['item:plant_fiber', 4],
    ]);
    expect(pairs(recipe('campfire').inputs)).toEqual([
      ['tag:log', 2],
      ['item:stick', 4],
      ['item:flint', 1],
    ]);
    expect(recipe('kiln').station).toBe('station:workbench');
    expect(pairs(recipe('kiln').inputs)).toEqual([
      ['item:clay_lump', 4],
      ['item:stone_shard', 6],
    ]);
    expect(pairs(recipe('bloomery').inputs)).toEqual([
      ['item:fire_bricks', 8],
      ['item:bronze_ingot', 2],
      ['item:stone_shard', 4],
    ]);
    for (const id of ['bronze_hatchet', 'bronze_pickaxe', 'bronze_blade'])
      expect(pairs(recipe(id).inputs), id).toContainEqual(['item:prowler_sinew', 1]);
  });

  it('alloys 3 copper and 1 cassiterite into 3 bronze; the bloomery burns charcoal only', () => {
    const bronze = process('bronze_ingot');
    expect([bronze.station, bronze.seconds, bronze.fuel]).toEqual(['station:kiln', 15, 'any']);
    expect(pairs(bronze.inputs)).toEqual([
      ['item:copper_ingot', 3],
      ['item:cassiterite', 1],
    ]);
    expect(bronze.output).toEqual({ item: 'item:bronze_ingot', count: 3 });
    const iron = process('iron_ingot');
    expect([iron.station, iron.seconds, iron.fuel]).toEqual(['station:bloomery', 20, 'charcoal']);
    expect(pairs(iron.inputs)).toEqual([['item:bog_iron', 2]]);
    expect(iron.output).toEqual({ item: 'item:iron_ingot', count: 1 });
    expect(process('copper_ingot').seconds).toBe(10);
    expect(process('charcoal').seconds).toBe(12);
    expect(process('grilled_meat').seconds).toBe(8);
    expect(process('flask_empty').seconds).toBe(10);
    expect(process('flask_boiled').seconds).toBe(6);
  });

  it('gives each processing station a lit block entity, the workbench its own; only the campfire may be kept lit', () => {
    const blocks = basePack.blocks.filter((b) => b.station !== undefined);
    expect(blocks.map((b) => b.station).sort()).toEqual([
      'station:bloomery',
      'station:campfire',
      'station:kiln',
      'station:workbench',
    ]);
    for (const block of blocks) {
      const fire = crafting.station(block.station!)!.burns !== undefined;
      expect(block.blockEntity, block.key).toBe(fire ? 'station' : 'workbench');
      expect(block.states?.includes('lit') ?? false, block.key).toBe(fire);
    }
    const kept = basePack.stations!.filter((s) => s.keepLit).map((s) => s.key);
    expect(kept).toEqual(['station:campfire']);
    const lit = registry.withState(registry.defaultState('block:campfire'), 'lit', '1');
    expect(registry.tables.emit[lit]).toBe(14);
    expect(registry.tables.emit[registry.defaultState('block:campfire')]).toBe(0);
    const chest = basePack.blocks.find((b) => b.key === 'block:chest')!;
    expect(chest.blockEntity).toBe('container');
  });

  it('follows the tool tier table and the stack sizes', () => {
    const tiers: Record<string, [number, number, number]> = {
      flint: [1, 2, 60],
      copper: [2, 3.5, 160],
      bronze: [3, 5, 320],
      iron: [4, 7, 640],
    };
    for (const [metal, [tier, speed, durability]] of Object.entries(tiers)) {
      for (const kind of ['hatchet', 'pickaxe']) {
        const tool = registry.item(`item:${metal}_${kind}`)!.tool!;
        expect([tool.tier, tool.speed, tool.durability], `${metal} ${kind}`).toEqual([
          tier,
          speed,
          durability,
        ]);
      }
    }
    expect(registry.maxStack('item:flint')).toBe(DEFAULT_STACK);
    expect(registry.maxStack('item:berries')).toBe(DEFAULT_STACK);
    expect(registry.maxStack('item:iron_blade')).toBe(1);
    expect(registry.maxStack('item:fur_coat')).toBe(1);
    expect(registry.item('item:fur_coat')!.wear).toMatchObject({ slot: 'body', warmth: 10 });
    expect(registry.item('item:flask_raw')!.container).toEqual({
      charges: 3,
      contents: 'raw',
      emptyAs: 'item:flask_empty',
    });
    expect(registry.item('item:cassiterite')!.hintKey).toBe('where.cassiterite');
  });

  it('drops flint from gravel 35 % of the time and fibre from tall grass 60 %', () => {
    const share = (key: string, item: string) => {
      const table = registry.loot(key)!;
      const total = table.entries.reduce((sum, e) => sum + e.weight, table.empty ?? 0);
      return table.entries.find((e) => e.item === item)!.weight / total;
    };
    expect(share('loot:gravel', 'item:flint')).toBeCloseTo(0.35);
    expect(share('loot:tall_grass', 'item:plant_fiber')).toBeCloseTo(0.6);
    expect(basePack.structures!.map((s) => s.lootTables)).toEqual([
      { C: 'loot:camp' },
      { C: 'loot:cairn' },
    ]);
    expect(registry.loot('loot:cairn')!.entries.map((e) => e.item)).toContain('item:prowler_sinew');
  });
});

describe('crafting validation', () => {
  it('reports bad recipes, processes and stations with exact paths', () => {
    const pack = broken((p) => {
      const recipes = p.recipes!;
      recipes[0]!.inputs = [{ item: 'tag:nope', count: 0 }];
      recipes[1]!.station = 'station:nope';
      recipes[2]!.category = 'magic';
      recipes[3]!.output = { item: 'item:flint_knife', count: 2 };
      recipes[4]!.key = recipes[5]!.key;
      recipes[6]!.station = 'station:kiln';
      const processes = p.processes!;
      processes[0]!.station = 'station:workbench';
      processes[1]!.inputs = [
        { item: 'item:flint', count: 1 },
        { item: 'item:stick', count: 1 },
        { item: 'item:cord', count: 1 },
      ];
      processes[2]!.output = { item: 'item:nope', count: 1 };
      p.stations!.find((s) => s.key === 'station:bloomery')!.fuelSlot = false;
      const workbench = p.stations!.find((s) => s.key === 'station:workbench')!;
      workbench.keepLit = true;
      workbench.outputSlots = 0;
      p.creatures![0]!.loot = 'loot:nope';
    });
    const paths = validatePack(pack).map((i) => i.path);
    const bloomery = basePack.stations!.findIndex((s) => s.key === 'station:bloomery');
    const bench = basePack.stations!.findIndex((s) => s.key === 'station:workbench');
    expect(paths).toEqual(
      expect.arrayContaining([
        'recipes[0].inputs[0].item',
        'recipes[0].inputs[0].count',
        'recipes[1].station',
        'recipes[2].category',
        'recipes[3].output.count',
        'recipes[5].key',
        'recipes[6].station',
        'processes[0].station',
        'processes[1].inputs',
        'processes[2].output.item',
        `stations[${bloomery}]`,
        `stations[${bench}].keepLit`,
        `stations[${bench}].outputSlots`,
        'creatures[0].loot',
      ]),
    );
  });

  it('checks station blocks, structure chests, liquids and item data', () => {
    const pack = broken((p) => {
      const campfire = p.blocks!.find((b) => b.key === 'block:campfire')!;
      delete campfire.states;
      delete campfire.whenState;
      const kiln = p.blocks!.find((b) => b.key === 'block:kiln')!;
      delete kiln.station;
      delete p.blocks!.find((b) => b.key === 'block:workbench')!.blockEntity;
      const structure = p.structures![1]!;
      structure.lootTables = { S: 'loot:nope' };
      const water = p.blocks!.find((b) => b.key === 'block:fresh_water')!;
      (water.liquid as { fills: Record<string, string> }).fills = { 'item:flint': 'item:stick' };
      const sand = p.blocks!.find((b) => b.key === 'block:sand')!;
      sand.item = { hintKey: 'where.nope', fuel: { seconds: 0 } };
      const items = p.items!;
      items.find((i) => i.key === 'item:fur_coat')!.wear = { slot: 'tail', durability: 0 };
      items.find((i) => i.key === 'item:flask_raw')!.container = {
        charges: 6,
        contents: 'raw',
        emptyAs: 'item:flask_empty',
      };
      items.find((i) => i.key === 'item:berries')!.consume = { seconds: 0, returns: 'item:nope' };
    });
    const index = (key: string) => basePack.blocks.findIndex((b) => b.key === key);
    const item = (key: string) => basePack.items!.findIndex((i) => i.key === key);
    const paths = validatePack(pack).map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        `blocks[${index('block:campfire')}].states`,
        `blocks[${index('block:kiln')}].station`,
        `blocks[${index('block:workbench')}].blockEntity`,
        'structures[1].lootTables.S',
        `blocks[${index('block:fresh_water')}].liquid.fills`,
        `blocks[${index('block:sand')}].item.hintKey`,
        `blocks[${index('block:sand')}].item.fuel.seconds`,
        `items[${item('item:fur_coat')}].wear.slot`,
        `items[${item('item:fur_coat')}].wear.durability`,
        `items[${item('item:flask_raw')}].container.emptyAs`,
        `items[${item('item:berries')}].consume.seconds`,
        `items[${item('item:berries')}].consume.returns`,
      ]),
    );
  });
});
