import { Crafting } from './crafting.ts';
import { blockItemKey, harvests, packItems } from './items.ts';
import type { BlockDef, ContentPack, Ingredient, ToolDef } from './schema.ts';

/** World rules that change what can be found (the simulation's `WorldRules`). */
export interface ReachRules {
  readonly hostiles: boolean;
}

/** What a player can obtain, make and process. */
export interface Reach {
  readonly items: ReadonlySet<string>;
  readonly recipes: ReadonlySet<string>;
  readonly processes: ReadonlySet<string>;
}

/**
 * Everything a player can obtain from the start state, an empty inventory (docs « Atteignabilité »):
 * - the drops of blocks the world generates, once a tool harvests them (`harvests`);
 * - the loot of structure chests and of creatures (hostile ones only when the rules allow them);
 * - containers filled at the liquids the world generates;
 * - the output of recipes and processes whose ingredients, station and fuel are obtainable.
 * Repeated until nothing new appears. A loot entry counts whatever its weight, and amounts do
 * not matter: the world renews its blocks and creatures. Recipe discovery never blocks: a recipe
 * is revealed once one of its ingredients has been seen, before all of them are in hand.
 */
export function reachable(pack: ContentPack, rules: ReachRules): Reach {
  const all = packItems(pack);
  const crafting = new Crafting(pack, all);
  const loot = new Map((pack.loot ?? []).map((table) => [table.key as string, table]));
  const items = new Set<string>();
  const recipes = new Set<string>();
  const processes = new Set<string>();
  const addLoot = (key: string) => {
    for (const entry of loot.get(key)?.entries ?? []) items.add(entry.item);
  };
  const has = (ingredient: Ingredient) =>
    [...items].some((item) => crafting.matches(item, ingredient.item));
  const stationAt = (station: string) =>
    pack.blocks.some((b) => b.station === station && items.has(blockItemKey(b.key)));
  const tools = () =>
    all.filter((item) => item.tool && items.has(item.key)).map((item) => item.tool as ToolDef);

  for (const structure of pack.structures ?? [])
    for (const key of Object.values(structure.lootTables ?? {})) addLoot(key);
  for (const creature of pack.creatures ?? [])
    if (rules.hostiles || creature.category !== 'hostile') addLoot(creature.loot);

  const blocks = naturalBlocks(pack);
  for (let before = -1; items.size !== before; ) {
    before = items.size;
    const owned = tools();
    for (const block of blocks) {
      for (const [empty, filled] of Object.entries(block.liquid?.fills ?? {}))
        if (filled !== undefined && items.has(empty)) items.add(filled);
      if (block.hardness < 0 || !harvestable(block, owned)) continue;
      if (block.drops === 'self') items.add(blockItemKey(block.key));
      else if (block.drops !== 'none') addLoot(block.drops);
    }
    for (const recipe of crafting.recipes) {
      if (recipe.station !== undefined && !stationAt(recipe.station)) continue;
      if (!recipe.inputs.every(has)) continue;
      recipes.add(recipe.key);
      items.add(recipe.output.item);
    }
    for (const process of crafting.processes) {
      if (!stationAt(process.station) || !process.inputs.every(has)) continue;
      const fuel =
        process.fuel === 'none' ||
        [...items].some((i) => crafting.burnSeconds(i, process.fuel) > 0);
      if (!fuel) continue;
      processes.add(process.key);
      items.add(process.output.item);
    }
  }
  return { items, recipes, processes };
}

/** A block harvested bare-handed or with one of the tools owned. */
function harvestable(block: BlockDef, tools: readonly ToolDef[]): boolean {
  return harvests(block, undefined) || tools.some((tool) => harvests(block, tool));
}

/**
 * Blocks the world generates: worldgen rocks, shore banks, biome layers and plants, the features
 * biomes grow, ores and structure blocks.
 */
function naturalBlocks(pack: ContentPack): BlockDef[] {
  const keys = new Set<string>();
  const w = pack.worldgen;
  if (w) {
    for (const key of [w.bedrock, w.stone, w.deepStone, w.magma]) keys.add(key);
    for (const patch of w.banks.patches) keys.add(patch.block);
  }
  const features = new Map((pack.features ?? []).map((f) => [f.key as string, f]));
  for (const biome of pack.biomes ?? []) {
    for (const key of [biome.surface, biome.filler, biome.seabed, biome.liquid, biome.liquidCap])
      if (key !== undefined) keys.add(key);
    for (const plant of biome.plants ?? []) keys.add(plant.block);
    for (const { feature } of biome.features ?? []) {
      const def = features.get(feature);
      if (def) keys.add(def.block);
      if (def?.crown) keys.add(def.crown);
    }
  }
  for (const ore of pack.ores ?? []) keys.add(ore.block);
  for (const structure of pack.structures ?? [])
    for (const state of Object.values(structure.legend)) keys.add(state.split('[')[0]!);
  return pack.blocks.filter((block) => keys.has(block.key));
}
