import type { Crafting } from '../content/crafting.ts';
import type { ProcessDef, RecipeCategory, RecipeDef } from '../content/schema.ts';

/**
 * The Logbook's pure part (docs « Craft : le Logbook »): which recipes a player sees, in which
 * order, what each ingredient's pip shows, what the search and the « Can craft now » filter keep
 * and how many crafts each button queues. The Bag's Logbook lists the hand recipes, a Workbench's
 * its station's and the hand ones (decision 18, plan v3 « M18 »). A search finds every recipe and
 * process of the pack, discovered or not, those made elsewhere showing their station. The screen
 * (screens/logbook.ts) draws it; the simulation checks everything again.
 */

/** What a Logbook row makes: a recipe, or a station's process (found by a search only). */
export type LogbookRecipe = RecipeDef | ProcessDef;

/** The tab of a row's recipe (a process: materials). */
export function categoryOf(recipe: LogbookRecipe): RecipeCategory {
  return 'category' in recipe ? recipe.category : 'materials';
}

/** What the Logbook reads from the player (the app wires the simulation's own rules). */
export interface LogbookSource {
  readonly crafting: Crafting;
  /** The station whose recipes it lists (an open workbench's), or undefined: the hand recipes. */
  readonly station?: string;
  /** Items and tags the player has seen (the reveal rule). */
  readonly seen: Readonly<Record<string, boolean>>;
  /** The player's level (recipes of a higher level never craft: plan v3 « M22 »). */
  readonly level: number;
  /** Items in the inventory that fill an ingredient (an item, or a tag). */
  owned(ingredient: string): number;
  /** Crafts of a recipe its queue still takes (its entry's room, then the free entries). */
  room(recipe: RecipeDef): number;
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
  readonly recipe: LogbookRecipe;
  /** Made in this Logbook (else at `recipe.station`: shown by a search, never crafted here). */
  readonly here: boolean;
  /** The level the recipe needs, when the player has not reached it (else 0). */
  readonly needsLevel: number;
  readonly pips: readonly IngredientPip[];
  /**
   * Revealed (`Crafting.revealed`). An undiscovered recipe is listed greyed at the bottom: its
   * output shows, its unseen ingredients as « ? » with where they are found; it never crafts.
   */
  readonly discovered: boolean;
  /** Crafts the inventory pays for, at most the queue entry's maximum (0 while undiscovered). */
  readonly max: number;
  readonly craftable: boolean;
  /** Crafts of it the queue still takes. */
  readonly room: number;
}

/** The Logbook's buttons: one craft, five, or as many as the inventory pays for. */
export type CraftBatch = 1 | 5 | 'max';

export const CRAFT_BATCHES: readonly CraftBatch[] = [1, 5, 'max'];

/** Whether a pip is filled (enough of that ingredient for one craft). */
export function pipFilled(pip: IngredientPip): boolean {
  return pip.owned >= pip.required;
}

/**
 * Order of the rows: craftable, then the other revealed ones, then the undiscovered ones; those
 * made elsewhere after them (revealed, then not).
 */
function rank(row: RecipeRow): number {
  if (row.craftable) return 0;
  return (row.discovered ? 1 : 2) + (row.here ? 0 : 2);
}

/** Whether a recipe is made in a Logbook: a hand one anywhere, a station's at its workbench. */
function madeIn(recipe: LogbookRecipe, station: string | undefined): boolean {
  return 'category' in recipe && (recipe.station === undefined || recipe.station === station);
}

/**
 * Every recipe and process of the pack with its pips (those not made here for a search only):
 * craftable ones first, then the other revealed ones, then the undiscovered ones, then those made
 * elsewhere, each group in pack order (`maxCount`: the most crafts one command queues).
 */
export function logbookRows(source: LogbookSource, maxCount: number): RecipeRow[] {
  const crafting = source.crafting;
  const rows: RecipeRow[] = [];
  for (const recipe of [...crafting.recipes, ...crafting.processes]) {
    const here = madeIn(recipe, source.station);
    const discovered = crafting.revealed(recipe, source.seen);
    const level = 'level' in recipe ? (recipe.level ?? 0) : 0;
    const needsLevel = level > source.level ? level : 0;
    let max = discovered && here && needsLevel === 0 ? maxCount : 0;
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
    const room = here && 'category' in recipe ? source.room(recipe) : 0;
    rows.push({ recipe, here, needsLevel, pips, discovered, max, craftable: max > 0, room });
  }
  // Array.prototype.sort is stable: pack order is kept inside each group.
  return rows.sort((a, b) => rank(a) - rank(b));
}

/** What the search and the filter keep. */
export interface LogbookFilter {
  /** The search text as typed ('' keeps every row). */
  readonly query: string;
  /** « Can craft now »: only the rows the inventory pays for (never an undiscovered one). */
  readonly craftableOnly: boolean;
}

/** Text as the search compares it: lower case, without accents (« Écorce » finds « ecorce »). */
export function searchKey(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/**
 * The rows a filter keeps, in their order: without a query, those made here; with one, those
 * (made anywhere) whose output name or a shown ingredient name holds it (an undiscovered recipe's
 * unseen ingredients show as « ? », so their names are not searched). `nameOf` names an item or
 * tag key as the screen shows it (`t()`).
 */
export function filterRows(
  rows: readonly RecipeRow[],
  filter: LogbookFilter,
  nameOf: (key: string) => string,
): RecipeRow[] {
  const query = searchKey(filter.query);
  const holds = (key: string) => searchKey(nameOf(key)).includes(query);
  return rows.filter(
    (row) =>
      (!filter.craftableOnly || row.craftable) &&
      (query === ''
        ? row.here
        : holds(row.recipe.output.item) ||
          row.pips.some((pip) => shownName(row, pip) && holds(pip.key))),
  );
}

/** Whether a pip shows its ingredient's name (not « ? »: an unseen one of an undiscovered recipe). */
export function shownName(row: RecipeRow, pip: IngredientPip): boolean {
  return row.discovered || pip.seen;
}

/**
 * The revealed recipes the Bag's Logbook leaves to a station (« 3 more at the Workbench »), by
 * station in pack order; none for a station's Logbook.
 */
export function stationRecipes(source: LogbookSource): { station: string; count: number }[] {
  const counts = new Map<string, number>();
  if (source.station !== undefined) return [];
  for (const recipe of source.crafting.recipes) {
    const station = recipe.station;
    if (station !== undefined && source.crafting.revealed(recipe, source.seen))
      counts.set(station, (counts.get(station) ?? 0) + 1);
  }
  return [...counts].map(([station, count]) => ({ station, count }));
}

/**
 * Crafts a button queues (0: the button is off: not craftable, too few, or no room left in the
 * queue for them).
 */
export function batchCount(batch: CraftBatch, row: RecipeRow): number {
  if (!row.craftable) return 0;
  const count = batch === 'max' ? Math.min(row.max, row.room) : batch;
  return count <= row.max && count <= row.room ? count : 0;
}
