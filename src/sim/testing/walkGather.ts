import { blockItemKey } from '../../content/items.ts';
import { FLAG_LIQUID, FLAG_REPLACEABLE } from '../../content/registry.ts';
import type { BlockDef, CreatureDef, OreDef, ProcessDef, RecipeDef } from '../../content/schema.ts';
import { findBiome } from '../../world/gen/find.ts';
import { pointInfo } from '../../world/gen/sample.ts';
import { isGone } from '../creatures.ts';
import { bodyInCell } from '../placement.ts';
import { hourOf } from '../time.ts';
import { Hands } from './walkHands.ts';
import { type Cell, cellText, type WalkPort } from './walkPort.ts';
import { aimToBreak, solidAt, standable, standFor } from './walkReach.ts';

/*
 * What the objectives walk takes from the world (walkSupplies.ts decides when): blocks that drop
 * an item are broken (walkHands.ts) — the nearest one the walk can reach around the player, in the
 * biome of its deposit for an ore (a journey from home), else one staged beside the player (a
 * one-cell `debug.fill`, when none lies within a short search) — and creatures that leave it are
 * struck down in a pit. Read from the pack's data: blocks, loot tables, ores, creatures.
 */

/** Most blocks broken for one item, creatures hunted, and blows at one creature. */
const MAX_HARVESTS = 400;
const MAX_HUNTS = 8;
const MAX_BLOWS = 12;
/** Sources are looked for this far around the player: to the side, below and above. */
const SOURCE_SIDE = 12;
const SOURCE_BELOW = 24;
const SOURCE_ABOVE = 8;
/** The nearest sources tried for a stand that sees them. */
const SOURCE_TRIES = 24;
/** Hunts happen at night (a light-shy creature burrows away by day), in a pit this deep. */
const NIGHT_HOUR = 23;
const PIT_DEPTH = 2;
/** Ticks a killed creature gets to fall over and be gone. */
const DYING_LIMIT = 120;
/** Cells around the feet a source may be staged in: to the side, below and above. */
const STAGE_SIDE = 2;
const STAGE_BELOW = 1;
const STAGE_ABOVE = 1;
/** How far over the feet the floor of a staging pod's stand lies (the body stays below it). */
const POD_RISE = 3;

/** The walk's sources in the world; the walk itself picks the hunting pit. */
export abstract class Gathering extends Hands {
  private readonly searchRadius: number;

  constructor(port: WalkPort, options: { readonly searchRadius: number }) {
    super(port);
    this.searchRadius = options.searchRadius;
  }

  /** The bottom cell of the hunting pit, dug into the ground beside home. */
  protected abstract pitSpot(): Cell;

  protected recipeFor(item: string): RecipeDef | undefined {
    return this.registry.crafting.recipes.find((r) => r.output.item === item);
  }

  protected processFor(item: string): ProcessDef | undefined {
    return this.registry.crafting.processes.find((p) => p.output.item === item);
  }

  /** Neither a recipe nor a process makes it: it is found in the world. */
  protected isRaw(item: string): boolean {
    return !this.recipeFor(item) && !this.processFor(item);
  }

  /**
   * The world's blocks that drop an item: those no recipe or process makes (a torch or a plank is
   * no source of itself).
   */
  protected sourcesOf(item: string): BlockDef[] {
    return this.registry.blocks.filter(
      (b) => this.isRaw(blockItemKey(b.key)) && this.dropChance(b, item) > 0,
    );
  }

  /** How often a block broken with the right tool drops an item: its own item, or a loot share. */
  private dropChance(block: BlockDef, item: string): number {
    if (block.drops === 'self') return blockItemKey(block.key) === item ? 1 : 0;
    const table = block.drops === 'none' ? undefined : this.registry.loot(block.drops);
    if (!table) return 0;
    const share = (sum: number, e: { readonly item: string; readonly weight: number }) =>
      sum + (e.item === item ? e.weight : 0);
    const total = table.entries.reduce((sum, e) => sum + e.weight, table.empty ?? 0);
    return table.entries.reduce(share, 0) / total;
  }

  /**
   * Breaks blocks that drop an item and picks it up until the inventory holds `need`: the nearest
   * source the walk can reach, in its deposit's biome for an ore, else one staged beside the
   * player.
   */
  protected async harvest(item: string, need: number, sources: readonly BlockDef[]): Promise<void> {
    const ore = this.depositOf(item);
    if (ore) await this.fetch(ore);
    for (let n = 0; n < MAX_HARVESTS && this.count(item) < need; n++) {
      const cell = this.sourceNear(sources) ?? this.stage(item, sources);
      const before = this.count(item);
      if (!(await this.breakAt(cell)))
        throw new Error(`no stand sees the source at ${cellText(cell)}`);
      await this.pickUp(item, before, { x: cell.x + 0.5, y: cell.y, z: cell.z + 0.5 });
    }
    if (this.count(item) < need)
      throw new Error(`${MAX_HARVESTS} blocks broken left ${this.count(item)} × ${item}`);
  }

  /** The nearest source block around the player that a stand sees (null: none in the search). */
  private sourceNear(sources: readonly BlockDef[]): Cell | null {
    const world = this.view.world;
    const blockOf = this.registry.tables.blockOf;
    const wanted = new Set(sources.map((b) => this.registry.blocks.indexOf(b)));
    const f = this.feet();
    const found: Cell[] = [];
    for (let y = f.y - SOURCE_BELOW; y <= f.y + SOURCE_ABOVE; y++)
      for (let z = f.z - SOURCE_SIDE; z <= f.z + SOURCE_SIDE; z++)
        for (let x = f.x - SOURCE_SIDE; x <= f.x + SOURCE_SIDE; x++)
          if (wanted.has(blockOf[world.getBlock(x, y, z)]!)) found.push({ x, y, z });
    const away = (c: Cell) => (c.x - f.x) ** 2 + (c.y - f.y) ** 2 + (c.z - f.z) ** 2;
    found.sort((a, b) => away(a) - away(b));
    for (const cell of found.slice(0, SOURCE_TRIES))
      if (standFor(world, this.registry, cell, f, aimToBreak(world, this.registry, cell)))
        return cell;
    return null;
  }

  /**
   * Stages the source that drops an item most often near the player's feet (a one-cell
   * `debug.fill`): none lies within the search. The nearest cell that is free (replaceable, no
   * liquid, not the body's) on solid ground and that a stand sees once the block is in; else one
   * in a stone pod built over the player (stand and source on its floor, walled off from water).
   */
  private stage(item: string, sources: readonly BlockDef[]): Cell {
    const best = sources.reduce((a, b) =>
      this.dropChance(b, item) > this.dropChance(a, item) ? b : a,
    );
    const state = this.registry.defaultState(best.key);
    const world = this.view.world;
    const flags = this.registry.tables.flags;
    const f = this.feet();
    const cells: Cell[] = [];
    for (let dy = -STAGE_BELOW; dy <= STAGE_ABOVE; dy++)
      for (let dz = -STAGE_SIDE; dz <= STAGE_SIDE; dz++)
        for (let dx = -STAGE_SIDE; dx <= STAGE_SIDE; dx++) {
          const cell = { x: f.x + dx, y: f.y + dy, z: f.z + dz };
          const flag = flags[world.getBlock(cell.x, cell.y, cell.z)]!;
          const free = (flag & FLAG_REPLACEABLE) !== 0 && (flag & FLAG_LIQUID) === 0;
          const ground = solidAt(world, this.registry, { x: cell.x, y: cell.y - 1, z: cell.z });
          const body = bodyInCell(this.view.entities, this.registry, cell.x, cell.y, cell.z);
          if (free && ground && !body) cells.push(cell);
        }
    const away = (c: Cell) => (c.x - f.x) ** 2 + (c.y - f.y) ** 2 + (c.z - f.z) ** 2;
    cells.sort((a, b) => away(a) - away(b));
    for (const cell of cells) {
      const was = world.getBlock(cell.x, cell.y, cell.z);
      this.fill(cell.x, cell.y, cell.z, cell.x, cell.y, cell.z, state);
      if (standFor(world, this.registry, cell, f, aimToBreak(world, this.registry, cell)))
        return cell;
      this.fill(cell.x, cell.y, cell.z, cell.x, cell.y, cell.z, was);
    }
    return this.stageInPod(state);
  }

  /**
   * A source block in a stone pod over the player's head (clear of the body): a floor, walls and
   * a roof around a stand (feet and head cells) and the source beside it.
   */
  private stageInPod(state: number): Cell {
    const f = this.feet();
    const stand = { x: f.x, y: f.y + POD_RISE, z: f.z };
    const source = { x: stand.x + 1, y: stand.y, z: stand.z };
    const { x, y, z } = stand;
    this.fill(x - 1, y - 1, z - 1, x + 2, y + 2, z + 1, this.wallState());
    this.fill(x, y, z, x, y + 1, z, this.registry.air);
    this.fill(source.x, source.y, source.z, source.x, source.y, source.z, state);
    return source;
  }

  /** The biome-bound deposit (ore) whose block is the item. */
  private depositOf(item: string): OreDef | undefined {
    const ores = this.registry.pack.ores ?? [];
    return ores.find((o) => o.biomes !== '*' && blockItemKey(o.block) === item);
  }

  protected creatureWith(item: string): CreatureDef | undefined {
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

  /**
   * Kills creatures that leave an item until the inventory holds `need`: each placed at night in
   * a pit dug beside home (it cannot run off, and a light-shy one does not burrow away), struck
   * from the pit's edge with a weapon of the inventory; the walk then goes down onto the loot. The
   * clock goes back to its hour afterwards.
   */
  protected async hunt(
    creature: CreatureDef,
    item: string,
    need: number,
    weapon: string,
  ): Promise<void> {
    const pit = this.pitSpot();
    const edge = { x: pit.x + 1, y: pit.y + PIT_DEPTH, z: pit.z };
    this.fill(pit.x, pit.y, pit.z, pit.x, pit.y + PIT_DEPTH - 1, pit.z, this.registry.air);
    if (!standable(this.view.world, this.registry, edge))
      throw new Error(`the edge of the pit at ${cellText(pit)} is no ground to stand on`);
    const hour = hourOf(this.view.time().ticks);
    this.port.send({ type: 'debug.setTime', hours: NIGHT_HOUR });
    for (let hunt = 0; hunt < MAX_HUNTS && this.count(item) < need; hunt++) {
      const at = { x: pit.x + 0.5, y: pit.y, z: pit.z + 0.5 };
      this.port.send({ type: 'debug.spawn', creature: creature.key, ...at });
      const id = this.newest(creature.key);
      if (id < 0) throw new Error(`no ${creature.key} could be placed at ${cellText(pit)}`);
      const alive = () => {
        const c = this.view.entities.get(id);
        return c?.kind === 'creature' && !isGone(c);
      };
      const slot = this.toHotbar(weapon);
      const before = this.count(item);
      for (let blow = 0; blow < MAX_BLOWS && alive(); blow++) {
        // Back to the middle of the edge (a blow taken pushes the player off): the pit's rim
        // stays out of the blow's way.
        await this.standIn(edge);
        await this.strike(id, slot);
      }
      if (alive()) throw new Error(`the ${creature.key} still stands after ${MAX_BLOWS} blows`);
      this.stepUntil(() => !this.view.entities.has(id), DYING_LIMIT);
      await this.pickUp(item, before, at);
    }
    this.port.send({ type: 'debug.setTime', hours: hour });
    if (this.count(item) < need) throw new Error(`${MAX_HUNTS} ${creature.key} left no ${item}`);
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
