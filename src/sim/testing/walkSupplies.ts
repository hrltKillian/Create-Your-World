import { fuelSlotOf, outputSlotOf } from '../../content/crafting.ts';
import { blockItemKey } from '../../content/items.ts';
import type { Ingredient, ProcessDef, RecipeDef, StationDef } from '../../content/schema.ts';
import { type WorkbenchEntity, withinReach } from '../blockEntities.ts';
import { ticksOf } from '../clock.ts';
import { OPEN_SLOTS_BASE } from '../commands.ts';
import { queueRoom } from '../craftQueue.ts';
import { countMatching } from '../inventory.ts';
import { STATION_REACH } from '../objectives.ts';
import { moveClicks, shiftClick } from './slotMoves.ts';
import { Gathering } from './walkGather.ts';
import { type Cell, cellText, type WalkPort } from './walkPort.ts';

/*
 * How the objectives walk (objectiveWalk.ts) gets its items, from the pack's data. A recipe is
 * crafted through the Logbook's queue: by hand, or at its workbench, open meanwhile (its outputs
 * taken as they come); a process run in its station (inputs, the longest-burning gathered fuel,
 * the outputs taken back). An item an objective names comes the
 * world's way whenever the world yields it (walkGather.ts): the blocks that drop it are broken, the
 * creatures that leave it struck down with the weapon that reaches farthest. Every other raw
 * material (logs, stone, clay, fuel, ores no objective names, hides, fur, resin) is given by
 * `debug.give`. Stations are crafted, then placed by hand on the home floor.
 */

/** Recipes nest at most this deep (a guard against a cycle in a pack's recipes). */
const MAX_DEPTH = 12;
/** Ticks a craft or a process gets past its own duration. */
const SLACK_TICKS = 30;
/** Aim just under the top of a floor block (a station goes on it). */
const TOP = 15 / 16;

/** The walk's means of getting items; the walk itself picks the station spots. */
export abstract class Supplies extends Gathering {
  /** Every item an objective names: those the world yields come from it. */
  private readonly named: ReadonlySet<string>;
  private readonly stations = new Map<string, Cell>();

  constructor(port: WalkPort, options: { readonly searchRadius: number }) {
    super(port, options);
    const objectives = this.registry.pack.objectives ?? [];
    this.named = new Set(objectives.flatMap((o) => o.condition.items ?? []));
  }

  /** Where the next station goes (a floor cell of the home room). */
  protected abstract nextSpot(): Cell;

  /** Gets the inventory up to `need` items filling an ingredient. */
  protected async obtain(ingredient: string, need: number, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) throw new Error(`${ingredient}: recipes nest deeper than ${MAX_DEPTH}`);
    if (this.count(ingredient) >= need) return;
    const item = this.itemFor(ingredient);
    const named = this.named.has(item);
    const sources = named ? this.sourcesOf(item) : [];
    const recipe = this.recipeFor(item);
    const process = recipe ? undefined : this.processFor(item);
    const creature = named && !recipe && !process ? this.creatureWith(item) : undefined;
    const missing = need - this.count(ingredient);
    if (sources.length > 0) await this.harvest(item, need, sources);
    else if (recipe) await this.craft(recipe, Math.ceil(missing / recipe.output.count), depth);
    else if (process)
      await this.runProcess(process, Math.ceil(missing / process.output.count), depth);
    else if (creature) await this.hunt(creature, item, need, await this.weapon(depth));
    else this.port.send({ type: 'debug.give', item, count: missing });
    if (this.count(ingredient) < need)
      throw new Error(
        `could not get ${need} × ${ingredient} (${this.count(ingredient)} in the bag)`,
      );
  }

  /** The weapon that reaches farthest (a spear), made first when the inventory has none. */
  private async weapon(depth: number): Promise<string> {
    const weapons = this.registry.items.filter((i) => i.weapon !== undefined);
    const longest = weapons.reduce((a, b) => (b.weapon!.reach > a.weapon!.reach ? b : a));
    await this.obtain(longest.key, 1, depth + 1);
    return longest.key;
  }

  /** A station within reach of home's middle (placed there first if needed); its cell. */
  protected async station(key: string, depth: number): Promise<Cell> {
    await this.goHome();
    const placed = this.stations.get(key);
    if (placed && this.stationAt(placed, key)) return placed;
    const block = this.registry.blocks.find((b) => b.station === key);
    if (!block) throw new Error(`no block is the station ${key}`);
    const item = blockItemKey(block.key);
    await this.obtain(item, 1, depth + 1);
    await this.goHome();
    const cell = this.nextSpot();
    const slot = this.toHotbar(item);
    await this.port.hold(
      'secondary',
      slot,
      { x: cell.x + 0.5, y: cell.y - 1 + TOP, z: cell.z + 0.5 },
      1,
    );
    const state = this.registry.states[this.view.world.getBlock(cell.x, cell.y, cell.z)]!;
    if (this.registry.blockDef(state.id).station !== key)
      throw new Error(`placing ${item} at ${cellText(cell)} left ${state.key} there`);
    this.stations.set(key, cell);
    return cell;
  }

  /** Whether a station's block still stands at a cell within an objective's reach of the player. */
  private stationAt(cell: Cell, key: string): boolean {
    const { x, y, z } = cell;
    const here = this.registry.blockDef(this.view.world.getBlock(x, y, z)).station === key;
    return here && withinReach(this.me(), x, y, z, STATION_REACH);
  }

  /** An item that fills an ingredient: itself, or the first item that carries the tag. */
  private itemFor(ingredient: string): string {
    if (this.registry.itemId(ingredient) >= 0) return ingredient;
    const item = this.registry.items.find((i) => i.tags?.some((tag) => tag === ingredient));
    if (!item) throw new Error(`no item fills ${ingredient}`);
    return item.key;
  }

  /** Gets the ingredients of `times` crafts or runs (again if one used up another). */
  private async inputs(inputs: readonly Ingredient[], times: number, depth: number): Promise<void> {
    const short = () => inputs.some((i) => this.count(i.item) < i.count * times);
    for (let pass = 0; pass < 3 && short(); pass++)
      for (const input of inputs) await this.obtain(input.item, input.count * times, depth + 1);
  }

  /**
   * Queues `crafts` crafts of a recipe as the Logbook does, as many at a time as the queue takes,
   * and waits until they are done: a workbench recipe at its bench, open meanwhile, whose outputs
   * are taken as they come.
   */
  private async craft(recipe: RecipeDef, crafts: number, depth: number): Promise<void> {
    // The station first: making it must not use up the inputs (a campfire burns logs).
    const bench = recipe.station === undefined ? null : await this.station(recipe.station, depth);
    await this.inputs(recipe.inputs, crafts, depth);
    if (bench) {
      // Gathering may have led the walk away from the bench.
      await this.goHome();
      this.open(bench);
    }
    const queue = () => (bench ? this.workbench(bench).craft : this.me().craft);
    const done = () => {
      if (bench) this.takeOutputs(bench);
      return queue().length === 0;
    };
    for (let left = crafts; left > 0; ) {
      const count = Math.min(left, queueRoom(this.registry, queue(), recipe));
      this.port.send({ type: 'craft.enqueue', recipe: recipe.key, count });
      if (queue().length === 0)
        throw new Error(`${recipe.key} × ${count} was refused (queue empty after enqueue)`);
      if (!this.stepUntil(done, ticksOf(recipe.seconds) * count + SLACK_TICKS))
        throw new Error(`${recipe.key} × ${count} is still queued`);
      left -= count;
    }
    if (bench) this.port.send({ type: 'screen.close' });
    // The next tick notes the output seen (tick step 9 reads the inventory).
    this.port.step(1);
  }

  /** The workbench at a cell. */
  private workbench(cell: Cell): Readonly<WorkbenchEntity> {
    const entity = this.view.blockEntity(cell.x, cell.y, cell.z);
    if (entity?.kind !== 'workbench') throw new Error(`no workbench at ${cellText(cell)}`);
    return entity;
  }

  /** Shift+clicks every filled output of the open workbench at a cell into the inventory. */
  private takeOutputs(cell: Cell): void {
    const slots = this.workbench(cell).slots;
    for (let slot = 0; slot < slots.length; slot++)
      if (slots[slot]) this.port.send(shiftClick(OPEN_SLOTS_BASE + slot));
  }

  /** Runs a process `runs` times in its station: inputs and fuel in, the outputs taken back. */
  private async runProcess(process: ProcessDef, runs: number, depth: number): Promise<void> {
    const cell = await this.station(process.station, depth);
    const def = this.registry.crafting.station(process.station)!;
    await this.inputs(process.inputs, runs, depth);
    const fuel = this.fuelFor(process, runs);
    if (fuel) await this.obtain(fuel.item, fuel.count, depth + 1);
    await this.goHome();
    this.open(cell);
    process.inputs.forEach((input, slot) => {
      this.load(cell, input.item, input.count * runs, slot);
    });
    if (fuel) this.load(cell, fuel.item, fuel.count, fuelSlotOf(def));
    this.port.send({ type: 'screen.close' });
    const want = runs * process.output.count;
    const made = () => this.outputs(cell, def, process.output.item);
    const ticks = ticksOf(process.seconds) * runs + SLACK_TICKS;
    if (!this.stepUntil(() => made() >= want, ticks, 10)) {
      const slots = this.view.blockEntity(cell.x, cell.y, cell.z)?.slots ?? [];
      const held = slots.map((s) => (s ? `${s.item} × ${s.count}` : '-')).join(', ');
      throw new Error(`${process.key} × ${runs} made ${made()} in ${ticks} ticks (${held})`);
    }
    this.open(cell);
    const out = outputSlotOf(def);
    for (let slot = out; slot < out + def.outputSlots; slot++)
      if (this.view.blockEntity(cell.x, cell.y, cell.z)?.slots[slot])
        this.port.send(shiftClick(OPEN_SLOTS_BASE + slot));
    this.port.send({ type: 'screen.close' });
  }

  /** The station's outputs of an item. */
  private outputs(cell: Cell, def: StationDef, item: string): number {
    const slots = this.view.blockEntity(cell.x, cell.y, cell.z)?.slots ?? [];
    const out = outputSlotOf(def);
    return countMatching(slots, out, out + def.outputSlots, this.registry.crafting, item);
  }

  /**
   * The fuel of `runs` runs: the gathered fuel the process burns longest (charcoal-grade fuel is
   * made, so a bloomery gets it), as many as the runs burn through.
   */
  private fuelFor(process: ProcessDef, runs: number): { item: string; count: number } | null {
    if (process.fuel === 'none') return null;
    const crafting = this.registry.crafting;
    const burns = this.registry.items.filter((i) => crafting.burnSeconds(i.key, process.fuel) > 0);
    const gathered = burns.filter((i) => this.isRaw(i.key));
    let best: string | null = null;
    for (const item of gathered.length > 0 ? gathered : burns)
      if (
        !best ||
        crafting.burnSeconds(item.key, process.fuel) > crafting.burnSeconds(best, process.fuel)
      )
        best = item.key;
    if (!best) throw new Error(`nothing burns for ${process.key}`);
    const burn = ticksOf(crafting.burnSeconds(best, process.fuel));
    return { item: best, count: Math.ceil((ticksOf(process.seconds) * runs) / burn) };
  }

  /** Opens a station's screen within reach (`debug.open`: no aiming). */
  private open(cell: Cell): void {
    this.port.send({ type: 'debug.open', ...cell });
    if (this.me().screen?.kind !== 'block')
      throw new Error(`the station at ${cellText(cell)} did not open`);
  }

  /**
   * Moves `count` items filling an ingredient from the inventory into a slot of the open station
   * at a cell, by clicks.
   */
  private load(cell: Cell, ingredient: string, count: number, slot: number): void {
    const inventory = this.me().inventory;
    const to = OPEN_SLOTS_BASE + slot;
    let left = count;
    for (let from = 0; from < inventory.length && left > 0; from++) {
      const stack = inventory[from];
      if (!stack || !this.registry.crafting.matches(stack.item, ingredient)) continue;
      const moved = Math.min(left, stack.count);
      const there = this.view.blockEntity(cell.x, cell.y, cell.z)?.slots[slot];
      for (const click of moveClicks(this.registry, from, to, stack, there, moved))
        this.port.send(click);
      left -= moved;
    }
  }
}
