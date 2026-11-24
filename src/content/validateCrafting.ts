import {
  type ContentPack,
  type Ingredient,
  type ItemCount,
  RECIPE_CATEGORIES,
  type StationDef,
} from './schema.ts';
import type { ItemRefs } from './validateItems.ts';

type AddIssue = (path: string, message: string) => void;

const isCount = (v: number, min: number) => Number.isInteger(v) && v >= min;

/** Stations and the blocks that are stations, recipes, processes and the loot of structure chests. */
export function validateCrafting(pack: ContentPack, refs: ItemRefs, add: AddIssue): void {
  const stations = checkStations(pack, add);
  const inputs = (path: string, list: readonly Ingredient[]) => {
    if (list.length === 0) add(path, 'needs at least one input');
    list.forEach((input, i) => {
      const known = input.item.startsWith('tag:')
        ? refs.tags.has(input.item)
        : refs.items.has(input.item);
      if (!known) add(`${path}[${i}].item`, `no item is or carries "${input.item}"`);
      if (!isCount(input.count, 1)) add(`${path}[${i}].count`, 'must be an integer ≥ 1');
    });
  };
  const output = (path: string, out: ItemCount) => {
    const def = refs.items.get(out.item);
    if (!def) add(`${path}.item`, `unknown item "${out.item}"`);
    else if (!isCount(out.count, 1) || out.count > def.maxStack)
      add(`${path}.count`, `must be an integer 1–${def.maxStack} (one stack)`);
  };
  const keys = new Set<string>();
  const unique = (path: string, key: string, prefix: string) => {
    if (!key.startsWith(prefix)) add(`${path}.key`, `"${key}" must start with "${prefix}"`);
    if (keys.has(key)) add(`${path}.key`, `duplicate key "${key}"`);
    keys.add(key);
  };
  (pack.recipes ?? []).forEach((recipe, i) => {
    const path = `recipes[${i}]`;
    unique(path, recipe.key, 'recipe:');
    if (!RECIPE_CATEGORIES.includes(recipe.category))
      add(`${path}.category`, `unknown category "${recipe.category}"`);
    if (recipe.station !== undefined && !stations.has(recipe.station))
      add(`${path}.station`, `unknown station "${recipe.station}"`);
    if (!(recipe.seconds > 0)) add(`${path}.seconds`, 'must be > 0');
    inputs(`${path}.inputs`, recipe.inputs);
    output(`${path}.output`, recipe.output);
  });
  const charcoal = [...refs.items.values()].some((item) => item.fuel?.charcoal);
  (pack.processes ?? []).forEach((process, i) => {
    const path = `processes[${i}]`;
    unique(path, process.key, 'process:');
    const station = stations.get(process.station);
    if (!station?.burns) add(`${path}.station`, `"${process.station}" is no processing station`);
    else if (process.inputs.length > station.inputSlots)
      add(`${path}.inputs`, `more inputs than the ${station.inputSlots} slots of the station`);
    if (!(process.seconds > 0)) add(`${path}.seconds`, 'must be > 0');
    if (process.fuel === 'charcoal' && !charcoal) add(`${path}.fuel`, 'no item is charcoal');
    inputs(`${path}.inputs`, process.inputs);
    output(`${path}.output`, process.output);
  });
  checkStructureLoot(pack, refs, add);
}

/** Stations, and the blocks naming them. Returns the stations by key. */
function checkStations(pack: ContentPack, add: AddIssue): Map<string, StationDef> {
  const stations = new Map<string, StationDef>();
  (pack.stations ?? []).forEach((station, i) => {
    const path = `stations[${i}]`;
    if (!station.key.startsWith('station:'))
      add(`${path}.key`, `"${station.key}" must start with "station:"`);
    if (stations.has(station.key)) add(`${path}.key`, `duplicate station "${station.key}"`);
    stations.set(station.key, station);
    if (pack.strings[station.nameKey] === undefined)
      add(`${path}.nameKey`, `no string for "${station.nameKey}"`);
    const slots = [station.inputSlots, station.outputSlots];
    if (station.burns && !(slots.every((n) => isCount(n, 1)) && station.fuelSlot))
      add(path, 'a processing station needs input, fuel and output slots');
    if (!station.burns && (slots.some((n) => n !== 0) || station.fuelSlot))
      add(path, 'a station without fire has no slots');
  });
  pack.blocks.forEach((block, i) => {
    const path = `blocks[${i}]`;
    const station = block.station === undefined ? undefined : stations.get(block.station);
    if (block.station !== undefined && !station)
      add(`${path}.station`, `unknown station "${block.station}"`);
    if (block.blockEntity === 'station' && block.station === undefined)
      add(`${path}.station`, 'a station entity names its station');
    // A processing station keeps its slots and fire in a block entity; the fire lights it up.
    if (station?.burns && block.blockEntity !== 'station')
      add(`${path}.blockEntity`, 'a processing station is a station entity');
    if (station?.burns && !block.states?.includes('lit'))
      add(`${path}.states`, 'a processing station needs the "lit" state');
  });
  return stations;
}

/** Loot tables of structure chests: a legend character placing a container block. */
function checkStructureLoot(pack: ContentPack, refs: ItemRefs, add: AddIssue): void {
  const containers = new Set(
    pack.blocks.filter((b) => b.blockEntity === 'container').map((b) => b.key as string),
  );
  (pack.structures ?? []).forEach((structure, i) => {
    for (const [char, table] of Object.entries(structure.lootTables ?? {})) {
      const path = `structures[${i}].lootTables.${char}`;
      const state = structure.legend[char];
      if (state === undefined || !containers.has(state.split('[')[0]!))
        add(path, `"${char}" does not place a container`);
      if (!refs.loot.has(table)) add(path, `unknown loot table "${table}"`);
    }
  });
}
