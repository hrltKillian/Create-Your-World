import { fuelSlotOf, outputSlotOf } from '../../content/crafting.ts';
import { blockItemKey } from '../../content/items.ts';
import type { Registry } from '../../content/registry.ts';
import type {
  CreatureDef,
  Ingredient,
  OreDef,
  ProcessDef,
  RecipeDef,
  StationDef,
} from '../../content/schema.ts';
import { HOTBAR_SLOTS } from '../../core/player.ts';
import { findBiome } from '../../world/gen/find.ts';
import { pointInfo } from '../../world/gen/sample.ts';
import { ticksOf } from '../clock.ts';
import { OPEN_SLOTS_BASE } from '../commands.ts';
import type { SimView } from '../host.ts';
import { countMatching } from '../inventory.ts';
import type { PlayerState } from '../player.ts';
import { type Cell, cellText, type WalkPort } from './walkPort.ts';

/*
 * How the objectives walk (objectiveWalk.ts) gets its items, from the pack's data: a recipe is
 * crafted through the Logbook's queue at its station, a process run in its station (inputs, the
 * longest-burning gathered fuel, the outputs taken back), and a raw item given by debug command,
 * except the raw items the current objective names, which come the world's way: a deposit's in
 * its biome (a journey from home, the nearest column of it, where the item is given), a
 * creature's from its loot (one placed beside the player and killed). Stations are crafted, then
 * placed by hand on the home floor.
 */

/** Recipes nest at most this deep (a guard against a cycle in a pack's recipes). */
const MAX_DEPTH = 12;
/** Ticks a craft or a process gets past its own duration. */
const SLACK_TICKS = 30;
/** Ticks a creature's loot gets to fall and be picked up, and the most creatures hunted. */
const PICKUP_TICKS = 60;
const MAX_HUNTS = 8;
/** Aim just under the top of a floor block (a station goes on it). */
const TOP = 15 / 16;

/** The walk's state and its means of getting items; the walk itself picks the station spots. */
export abstract class Supplies {
  protected readonly port: WalkPort;
  protected readonly view: SimView;
  protected readonly registry: Registry;
  private readonly searchRadius: number;
  /** The feet cell in the middle of the home room. */
  protected home: Cell = { x: 0, y: 0, z: 0 };
  private readonly stations = new Map<string, Cell>();

  constructor(port: WalkPort, options: { readonly searchRadius: number }) {
    this.port = port;
    this.view = port.view;
    this.registry = port.view.registry;
    this.searchRadius = options.searchRadius;
  }

  /** Where the next station goes (a floor cell of the home room). */
  protected abstract nextSpot(): Cell;

  protected me(): Readonly<PlayerState> {
    const player = this.view.player();
    if (!player) throw new Error('no local player');
    return player;
  }

  /** Items in the inventory that fill an ingredient (an item, or a tag). */
  protected count(ingredient: string): number {
    const inventory = this.me().inventory;
    return countMatching(inventory, 0, inventory.length, this.registry.crafting, ingredient);
  }

  /**
   * Gets the inventory up to `need` items filling an ingredient. `wanted`: the items the current
   * objective names, which the world gives when they are raw.
   */
  protected async obtain(
    ingredient: string,
    need: number,
    wanted: ReadonlySet<string>,
    depth: number,
  ): Promise<void> {
    if (depth > MAX_DEPTH) throw new Error(`${ingredient}: recipes nest deeper than ${MAX_DEPTH}`);
    const missing = need - this.count(ingredient);
    if (missing <= 0) return;
    const item = this.itemFor(ingredient);
    const recipe = this.recipeFor(item);
    const process = recipe ? undefined : this.processFor(item);
    if (recipe) await this.craft(recipe, Math.ceil(missing / recipe.output.count), wanted, depth);
    else if (process)
      await this.runProcess(process, Math.ceil(missing / process.output.count), wanted, depth);
    else await this.gather(item, missing, wanted.has(ingredient));
    if (this.count(ingredient) < need)
      throw new Error(
        `could not get ${need} × ${ingredient} (${this.count(ingredient)} in the bag)`,
      );
  }

  /** A station within reach of home's middle (placed there first if needed); its cell. */
  protected async station(key: string, wanted: ReadonlySet<string>, depth: number): Promise<Cell> {
    await this.goHome();
    const placed = this.stations.get(key);
    if (placed && this.view.stationNear(key)) return placed;
    const block = this.registry.blocks.find((b) => b.station === key);
    if (!block) throw new Error(`no block is the station ${key}`);
    const item = blockItemKey(block.key);
    await this.obtain(item, 1, wanted, depth + 1);
    const cell = this.nextSpot();
    const slot = this.toHotbar(item);
    await this.port.use(slot, { x: cell.x + 0.5, y: cell.y - 1 + TOP, z: cell.z + 0.5 }, 1);
    const state = this.registry.states[this.view.world.getBlock(cell.x, cell.y, cell.z)]!;
    if (this.registry.blockDef(state.id).station !== key)
      throw new Error(`placing ${item} at ${cellText(cell)} left ${state.key} there`);
    this.stations.set(key, cell);
    return cell;
  }

  /** Back to the middle of the home room (unless the player stands there, or `force`). */
  protected async goHome(force = false): Promise<void> {
    const b = this.me().body;
    const { x, y, z } = this.home;
    const there = Math.abs(b.x - x - 0.5) + Math.abs(b.z - z - 0.5) + Math.abs(b.y - y) < 0.1;
    if (!there || force) await this.port.travel(x + 0.5, y, z + 0.5);
  }

  /** Steps `every` ticks at a time until `done` holds, at most `ticks`; returns whether it held. */
  protected stepUntil(done: () => boolean, ticks: number, every = 1): boolean {
    for (let t = 0; t < ticks; t += every) {
      if (done()) return true;
      this.port.step(every);
    }
    return done();
  }

  /** Fills a box (inclusive corners) with a block state (`debug.fill`). */
  protected fill(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    state: number,
  ): void {
    const key = this.registry.states[state]!.key;
    this.port.send({ type: 'debug.fill', x0, y0, z0, x1, y1, z1, state: key });
  }

  /** The block of floors and walls: the worldgen's stone (solid and opaque). */
  protected wallState(): number {
    const stone = this.registry.pack.worldgen?.stone;
    if (!stone) throw new Error('the pack has no worldgen stone for the home walls');
    return this.registry.defaultState(stone);
  }

  /** A hotbar slot with nothing in it (the bare hand), freed into the bag when none is. */
  protected emptyHand(): number {
    const inventory = this.me().inventory;
    const free = inventory.findIndex((stack, i) => i < HOTBAR_SLOTS && stack === null);
    if (free >= 0) return free;
    const bag = inventory.findIndex((stack, i) => i >= HOTBAR_SLOTS && stack === null);
    if (bag < 0) throw new Error('the inventory is full: no hand to free');
    this.port.send({ type: 'inv.move', from: HOTBAR_SLOTS - 1, to: bag });
    return HOTBAR_SLOTS - 1;
  }

  /** The hotbar slot of an item, moved there from the bag when needed. */
  private toHotbar(item: string): number {
    const inventory = this.me().inventory;
    const slot = inventory.findIndex((stack) => stack?.item === item);
    if (slot < 0) throw new Error(`no ${item} in the inventory`);
    if (slot < HOTBAR_SLOTS) return slot;
    const free = inventory.findIndex((stack, i) => i < HOTBAR_SLOTS && stack === null);
    const to = free >= 0 ? free : HOTBAR_SLOTS - 1;
    this.port.send({ type: 'inv.move', from: slot, to });
    return to;
  }

  /** An item that fills an ingredient: itself, or the first item that carries the tag. */
  private itemFor(ingredient: string): string {
    if (this.registry.itemId(ingredient) >= 0) return ingredient;
    const item = this.registry.items.find((i) => i.tags?.some((tag) => tag === ingredient));
    if (!item) throw new Error(`no item fills ${ingredient}`);
    return item.key;
  }

  private recipeFor(item: string): RecipeDef | undefined {
    return this.registry.crafting.recipes.find((r) => r.output.item === item);
  }

  private processFor(item: string): ProcessDef | undefined {
    return this.registry.crafting.processes.find((p) => p.output.item === item);
  }

  /** Neither a recipe nor a process makes it: it is found in the world. */
  private isRaw(item: string): boolean {
    return !this.recipeFor(item) && !this.processFor(item);
  }

  /** Gets the ingredients of `times` crafts or runs (again if one used up another). */
  private async inputs(
    inputs: readonly Ingredient[],
    times: number,
    wanted: ReadonlySet<string>,
    depth: number,
  ): Promise<void> {
    const short = () => inputs.some((i) => this.count(i.item) < i.count * times);
    for (let pass = 0; pass < 3 && short(); pass++)
      for (const input of inputs)
        await this.obtain(input.item, input.count * times, wanted, depth + 1);
  }

  /** Queues `crafts` crafts of a recipe (as the Logbook does) and waits until they are done. */
  private async craft(
    recipe: RecipeDef,
    crafts: number,
    wanted: ReadonlySet<string>,
    depth: number,
  ): Promise<void> {
    if (recipe.station !== undefined) await this.station(recipe.station, wanted, depth);
    await this.inputs(recipe.inputs, crafts, wanted, depth);
    const me = this.me();
    this.port.send({ type: 'craft.enqueue', recipe: recipe.key, count: crafts });
    if (me.craft.length === 0)
      throw new Error(`${recipe.key} × ${crafts} was refused (queue empty after enqueue)`);
    this.stepUntil(() => me.craft.length === 0, ticksOf(recipe.seconds) * crafts + SLACK_TICKS);
    if (me.craft.length > 0) throw new Error(`${recipe.key} × ${crafts} is still queued`);
    // The next tick notes the output seen (tick step 9 reads the inventory).
    this.port.step(1);
  }

  /** Runs a process `runs` times in its station: inputs and fuel in, the outputs taken back. */
  private async runProcess(
    process: ProcessDef,
    runs: number,
    wanted: ReadonlySet<string>,
    depth: number,
  ): Promise<void> {
    const cell = await this.station(process.station, wanted, depth);
    const def = this.registry.crafting.station(process.station)!;
    await this.inputs(process.inputs, runs, wanted, depth);
    const fuel = this.fuelFor(process, runs);
    if (fuel) await this.obtain(fuel.item, fuel.count, wanted, depth + 1);
    this.open(cell);
    process.inputs.forEach((input, slot) => {
      this.load(input.item, input.count * runs, slot);
    });
    if (fuel) this.load(fuel.item, fuel.count, fuelSlotOf(def));
    this.port.send({ type: 'container.close' });
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
        this.port.send({ type: 'station.move', from: OPEN_SLOTS_BASE + slot });
    this.port.send({ type: 'container.close' });
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
    if (!this.me().opened) throw new Error(`the station at ${cellText(cell)} did not open`);
  }

  /** Moves `count` items filling an ingredient from the inventory into a slot of the open station. */
  private load(ingredient: string, count: number, slot: number): void {
    const inventory = this.me().inventory;
    let left = count;
    for (let from = 0; from < inventory.length && left > 0; from++) {
      const stack = inventory[from];
      if (!stack || !this.registry.crafting.matches(stack.item, ingredient)) continue;
      const moved = Math.min(left, stack.count);
      this.port.send({ type: 'station.move', from, to: OPEN_SLOTS_BASE + slot, count: moved });
      left -= moved;
    }
  }

  /**
   * A raw item: given, unless the objective names it: then fetched in the biome of its deposit,
   * or taken from the loot of a creature.
   */
  private async gather(item: string, count: number, fromWorld: boolean): Promise<void> {
    const ore = fromWorld ? this.depositOf(item) : undefined;
    const creature = fromWorld && !ore ? this.creatureWith(item) : undefined;
    if (ore) await this.fetch(ore);
    if (creature) this.hunt(creature, item, count);
    else this.port.send({ type: 'debug.give', item, count });
  }

  /** The biome-bound deposit (ore) whose block is the item. */
  private depositOf(item: string): OreDef | undefined {
    const ores = this.registry.pack.ores ?? [];
    return ores.find((o) => o.biomes !== '*' && blockItemKey(o.block) === item);
  }

  private creatureWith(item: string): CreatureDef | undefined {
    const creatures = this.registry.pack.creatures ?? [];
    return creatures.find((c) => this.registry.loot(c.loot)?.entries.some((e) => e.item === item));
  }

  /** Travels to the nearest column of a deposit's biomes (none when home lies in one). */
  private async fetch(ore: OreDef): Promise<void> {
    const ctx = this.view.gen;
    const biomes = ore.biomes as readonly string[];
    if (biomes.includes(ctx.biomes[pointInfo(ctx, this.home.x, this.home.z).biome]!.def.key))
      return;
    let best = null as { x: number; z: number; distance: number } | null;
    for (const biome of biomes) {
      const hit = findBiome(ctx, biome, this.home, this.searchRadius);
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    if (!best)
      throw new Error(`no ${biomes.join(' or ')} within ${this.searchRadius} blocks of home`);
    await this.port.travel(best.x + 0.5, 'surface', best.z + 0.5);
  }

  /** Places creatures that carry the item in their loot beside the player and kills them. */
  private hunt(creature: CreatureDef, item: string, count: number): void {
    const target = this.count(item) + count;
    for (let hunt = 0; hunt < MAX_HUNTS && this.count(item) < target; hunt++) {
      const b = this.me().body;
      this.port.send({ type: 'debug.spawn', creature: creature.key, x: b.x + 1, y: b.y, z: b.z });
      const id = this.newest(creature.key);
      if (id < 0) throw new Error(`no ${creature.key} could be placed at ${cellText(this.home)}`);
      this.port.send({ type: 'debug.killCreature', id });
      this.stepUntil(() => this.count(item) >= target, PICKUP_TICKS);
    }
    if (this.count(item) < target) throw new Error(`${MAX_HUNTS} ${creature.key} left no ${item}`);
  }

  /** Entity id of the newest creature of a kind (−1: none). */
  private newest(creature: string): number {
    let id = -1;
    for (const [key, e] of this.view.entities)
      if (e.kind === 'creature' && e.creature === creature && e.mode !== 'dying')
        id = Math.max(id, key);
    return id;
  }
}
