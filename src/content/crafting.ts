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
  private readonly processesByStation = new Map<string, ProcessDef[]>();

  constructor(pack: ContentPack, items: readonly ItemDef[]) {
    this.recipes = pack.recipes ?? [];
    this.processes = pack.processes ?? [];
    this.stations = pack.stations ?? [];
    this.recipeIndex = new Map(this.recipes.map((r) => [r.key, r]));
    this.processIndex = new Map(this.processes.map((p) => [p.key, p]));
    this.stationIndex = new Map(this.stations.map((s) => [s.key, s]));
    this.itemIndex = new Map(items.map((item) => [item.key, item]));
    for (const station of this.stations)
      this.processesByStation.set(
        station.key,
        this.processes.filter((p) => p.station === station.key),
      );
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

  /** The processes a station runs, in pack order (the same array every call). */
  processesOf(station: string): readonly ProcessDef[] {
    return this.processesByStation.get(station) ?? [];
  }

  /**
   * Whether a player knows a recipe (docs « Craft : le Logbook »): known from the start, or one of
   * its ingredients has been seen. `seen` holds the item keys a player has had and their tags.
   */
  revealed(recipe: RecipeDef, seen: Readonly<Record<string, boolean>>): boolean {
    if (recipe.known === 'start') return true;
    for (const input of recipe.inputs) if (seen[input.item] === true) return true;
    return false;
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

  /**
   * Whether a station's fire can burn an item: a campfire any fuel, a kiln or bloomery only fuel
   * one of its processes burns (a bloomery's charcoal; logs would block its fuel slot).
   */
  burnsIn(station: StationDef, item: string): boolean {
    if (station.burns === 'whileFuel' && this.burnSeconds(item, 'any') > 0) return true;
    return this.processesOf(station.key).some((p) => this.burnSeconds(item, p.fuel) > 0);
  }

  /** Whether an item is an ingredient of one of a station's processes (an item or its tag). */
  feeds(station: StationDef, item: string): boolean {
    return this.processesOf(station.key).some((p) =>
      p.inputs.some((input) => this.matches(item, input.item)),
    );
  }
}

/**
 * Slot layout of a station block entity: its inputs (from 0), then its fuel slot if it has one,
 * then its outputs (the Station screen and the simulation share it).
 */
export function fuelSlotOf(station: StationDef): number {
  return station.fuelSlot ? station.inputSlots : -1;
}

export function outputSlotOf(station: StationDef): number {
  return station.inputSlots + (station.fuelSlot ? 1 : 0);
}

export function stationSlotCount(station: StationDef): number {
  return outputSlotOf(station) + station.outputSlots;
}

/**
 * Whether a slot of a station block entity takes an item (the simulation and the Station screen
 * share it): its inputs anything, its fuel slot what its fire burns, its outputs nothing.
 */
export function stationAccepts(
  crafting: Crafting,
  station: StationDef,
  slot: number,
  item: string,
): boolean {
  if (slot < station.inputSlots) return true;
  return slot === fuelSlotOf(station) && crafting.burnsIn(station, item);
}
