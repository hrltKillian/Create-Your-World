import type {
  ContentPack,
  ItemDef,
  ProcessDef,
  ProcessFuel,
  RecipeDef,
  StationDef,
} from './schema.ts';

/**
 * Recipes, processes and stations of a pack by key, and the two item rules they share (docs
 * « Craft : le Logbook », « Stations de transformation »): an ingredient names an item or a tag,
 * and a process burns any fuel, charcoal-grade fuel only, or nothing.
 */
export class Crafting {
  readonly recipes: readonly RecipeDef[];
  readonly processes: readonly ProcessDef[];
  readonly stations: readonly StationDef[];
  private readonly recipeIndex: ReadonlyMap<string, RecipeDef>;
  private readonly processIndex: ReadonlyMap<string, ProcessDef>;
  private readonly stationIndex: ReadonlyMap<string, StationDef>;
  private readonly itemIndex: ReadonlyMap<string, ItemDef>;

  constructor(pack: ContentPack, items: readonly ItemDef[]) {
    this.recipes = pack.recipes ?? [];
    this.processes = pack.processes ?? [];
    this.stations = pack.stations ?? [];
    this.recipeIndex = new Map(this.recipes.map((r) => [r.key, r]));
    this.processIndex = new Map(this.processes.map((p) => [p.key, p]));
    this.stationIndex = new Map(this.stations.map((s) => [s.key, s]));
    this.itemIndex = new Map(items.map((item) => [item.key, item]));
  }

  recipe(key: string): RecipeDef | undefined {
    return this.recipeIndex.get(key);
  }

  process(key: string): ProcessDef | undefined {
    return this.processIndex.get(key);
  }

  station(key: string): StationDef | undefined {
    return this.stationIndex.get(key);
  }

  /** The processes a station runs, in pack order. */
  processesOf(station: string): ProcessDef[] {
    return this.processes.filter((p) => p.station === station);
  }

  /** Whether an item fills an ingredient: the ingredient's item, or an item carrying its tag. */
  matches(item: string, ingredient: string): boolean {
    if (item === ingredient) return true;
    const tags: readonly string[] | undefined = this.itemIndex.get(item)?.tags;
    return tags?.includes(ingredient) ?? false;
  }

  /** Seconds an item burns under a process's fuel rule; 0 when that rule does not accept it. */
  burnSeconds(item: string, fuel: ProcessFuel): number {
    const def = this.itemIndex.get(item)?.fuel;
    if (def === undefined || fuel === 'none' || (fuel === 'charcoal' && !def.charcoal)) return 0;
    return def.seconds;
  }
}
