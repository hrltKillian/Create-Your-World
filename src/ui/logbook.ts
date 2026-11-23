import type { Crafting } from '../content/crafting.ts';
import type { RecipeDef } from '../content/schema.ts';

/**
 * The Logbook's pure part (docs « Craft : le Logbook »): which recipes a player sees, in which
 * order, what each ingredient's pip shows and how many crafts each button queues. The screen
 * (screens/logbook.ts) draws it; the simulation checks everything again.
 */

/** What the Logbook reads from the player (the app wires the simulation's own rules). */
export interface LogbookSource {
  readonly crafting: Crafting;
  /** Items and tags the player has seen (the reveal rule). */
  readonly seen: Readonly<Record<string, boolean>>;
  /** Items in the inventory that fill an ingredient (an item, or a tag). */
  owned(ingredient: string): number;
  /** Whether a block of a station stands within reach. */
  stationNear(station: string): boolean;
}

/** An ingredient's pip: owned / required for one craft. */
export interface IngredientPip {
  readonly key: string;
  readonly owned: number;
  readonly required: number;
  /** Seen at least once (else the Logbook shows where it is found). */
  readonly seen: boolean;
}

export interface RecipeRow {
  readonly recipe: RecipeDef;
  readonly pips: readonly IngredientPip[];
  /** Crafts the inventory pays for, at most the queue entry's maximum. */
  readonly max: number;
  /** Made by hand, or its station stands near. */
  readonly stationOk: boolean;
  readonly craftable: boolean;
}

/** The Logbook's buttons: one craft, five, or as many as the inventory pays for. */
export type CraftBatch = 1 | 5 | 'max';

export const CRAFT_BATCHES: readonly CraftBatch[] = [1, 5, 'max'];

/** Whether a pip is filled (enough of that ingredient for one craft). */
export function pipFilled(pip: IngredientPip): boolean {
  return pip.owned >= pip.required;
}

/**
 * Every revealed recipe with its pips, craftable ones first, then in pack order (`maxCount`: the
 * most crafts one queue entry holds). Each station is looked up once.
 */
export function logbookRows(source: LogbookSource, maxCount: number): RecipeRow[] {
  const crafting = source.crafting;
  const near = new Map<string, boolean>();
  const rows: RecipeRow[] = [];
  for (const recipe of crafting.recipes) {
    if (!crafting.revealed(recipe, source.seen)) continue;
    let max = maxCount;
    const pips = recipe.inputs.map((input): IngredientPip => {
      const owned = source.owned(input.item);
      max = Math.min(max, Math.floor(owned / input.count));
      return {
        key: input.item,
        owned,
        required: input.count,
        seen: source.seen[input.item] === true,
      };
    });
    let stationOk = true;
    const station = recipe.station;
    if (station !== undefined) {
      if (!near.has(station)) near.set(station, source.stationNear(station));
      stationOk = near.get(station)!;
    }
    rows.push({ recipe, pips, max, stationOk, craftable: max > 0 && stationOk });
  }
  // Array.prototype.sort is stable: pack order is kept inside each group.
  return rows.sort((a, b) => Number(b.craftable) - Number(a.craftable));
}

/** Recipes the player has not revealed yet. */
export function hiddenRecipes(source: LogbookSource): number {
  let hidden = 0;
  for (const recipe of source.crafting.recipes)
    if (!source.crafting.revealed(recipe, source.seen)) hidden++;
  return hidden;
}

/** Crafts a button queues (0: the button is off: not craftable, too few, or the queue is full). */
export function batchCount(batch: CraftBatch, row: RecipeRow, queueFull: boolean): number {
  if (!row.craftable || queueFull) return 0;
  const count = batch === 'max' ? row.max : batch;
  return count <= row.max ? count : 0;
}
