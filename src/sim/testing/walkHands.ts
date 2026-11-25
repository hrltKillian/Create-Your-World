import { blockItemKey, fitsTool, harvests } from '../../content/items.ts';
import type { Registry } from '../../content/registry.ts';
import type { BlockKey } from '../../content/schema.ts';
import { HOTBAR_SLOTS } from '../../core/player.ts';
import { TICKS_PER_SECOND } from '../clock.ts';
import type { SimView } from '../host.ts';
import { countMatching } from '../inventory.ts';
import { breakSeconds } from '../mining.ts';
import { eyeHeight } from '../physics.ts';
import { bodyInCell } from '../placement.ts';
import type { PlayerState } from '../player.ts';
import { emptySlot } from './botSenses.ts';
import { inBag, moveClicks } from './slotMoves.ts';
import { type Cell, cellText, type Point, type WalkPort } from './walkPort.ts';
import { type Aim, aimToBreak, aimToPlace, solidAt, standFor } from './walkReach.ts';

/*
 * The objectives walk's body (objectiveWalk.ts, walkSupplies.ts): the player's state and the
 * game's own actions on the world, as a player does them. A block is broken by holding primary
 * with the best tool that harvests it (the hand when none fits), a block placed by secondary on a
 * face of its neighbour, a creature struck by primary; the walk first stands where its eye sees
 * that block or face (walkReach.ts: the spot it stands on if it can, else the nearest one, reached
 * by a teleport), and walks onto the drops (a teleport onto one the walk does not reach).
 */

/** Ticks a broken block's drops get to be picked up where they fall, and the walk onto them. */
const PICKUP_TICKS = 10;
const WALK_TICKS = 40;
/** Drops are looked for within this distance of the block that left them. */
const DROP_RADIUS = 4;
/** Mining is held up to this many times the break time (stamina may run short meanwhile). */
const MINING_SLACK = 1.5;
/** Ticks a weapon's cooldown may take before a blow, and where a blow aims: near the top. */
const COOLDOWN_TICKS = 120;
const AIM_HEIGHT = 0.9;
/** Most ticks a body still sliding (after a walk onto a drop) gets to come to rest before aiming. */
const REST_TICKS = 20;

export abstract class Hands {
  protected readonly port: WalkPort;
  protected readonly view: SimView;
  protected readonly registry: Registry;
  /** The feet cell in the middle of the home room. */
  protected home: Cell = { x: 0, y: 0, z: 0 };

  constructor(port: WalkPort) {
    this.port = port;
    this.view = port.view;
    this.registry = port.view.registry;
  }

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

  /** The cell of the player's feet. */
  protected feet(): Cell {
    const b = this.me().body;
    return { x: Math.floor(b.x), y: Math.floor(b.y), z: Math.floor(b.z) };
  }

  protected blockAt(c: Cell): number {
    return this.view.world.getBlock(c.x, c.y, c.z);
  }

  /** Back to the middle of the home room (unless the player stands there, or `force`). */
  protected goHome(force = false): Promise<void> {
    return this.standIn(this.home, force);
  }

  /** To the middle of a cell, feet on its floor (unless the player stands there, or `force`). */
  protected async standIn(c: Cell, force = false): Promise<void> {
    const b = this.me().body;
    const there = Math.abs(b.x - c.x - 0.5) + Math.abs(b.z - c.z - 0.5) + Math.abs(b.y - c.y) < 0.1;
    if (!there || force) await this.port.travel(c.x + 0.5, c.y, c.z + 0.5);
  }

  /** Steps `every` ticks at a time until `done` holds, at most `ticks`; returns whether it held. */
  protected stepUntil(done: () => boolean, ticks: number, every = 1): boolean {
    for (let t = 0; t < ticks; t += every) {
      if (done()) return true;
      this.port.step(every);
    }
    return done();
  }

  /** Fills a box (inclusive corners) with a block state (`debug.fill`: staging only). */
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
  protected wallBlock(): BlockKey {
    const stone = this.registry.pack.worldgen?.stone;
    if (!stone) throw new Error('the pack has no worldgen stone for the walls');
    return stone;
  }

  protected wallState(): number {
    return this.registry.defaultState(this.wallBlock());
  }

  /** A hotbar slot with nothing in it (the bare hand), freed into the bag when none is. */
  protected emptyHand(): number {
    const inventory = this.me().inventory;
    const free = emptySlot(inventory, 0, HOTBAR_SLOTS);
    if (free >= 0) return free;
    const bag = emptySlot(inventory, HOTBAR_SLOTS, inventory.length);
    if (bag < 0) throw new Error('the inventory is full: no hand to free');
    this.move(HOTBAR_SLOTS - 1, bag);
    return HOTBAR_SLOTS - 1;
  }

  /** The hotbar slot of an item, moved there from the bag when needed. */
  protected toHotbar(item: string): number {
    const inventory = this.me().inventory;
    const slot = inventory.findIndex((stack) => stack?.item === item);
    if (slot < 0) throw new Error(`no ${item} in the inventory`);
    if (slot < HOTBAR_SLOTS) return slot;
    const free = emptySlot(inventory, 0, HOTBAR_SLOTS);
    const to = free >= 0 ? free : HOTBAR_SLOTS - 1;
    this.move(slot, to);
    return to;
  }

  /** Moves a whole stack between two inventory slots in the Bag (swapping with what is there). */
  private move(from: number, to: number): void {
    const inventory = this.me().inventory;
    const clicks = moveClicks(this.registry, from, to, inventory[from]!, inventory[to]);
    for (const command of inBag(...clicks)) this.port.send(command);
  }

  /**
   * Stands where the eye finds an aim at a cell (where the player is, else the nearest stand)
   * and returns the point to look at; null when no stand around the cell sees it.
   */
  protected async reach(cell: Cell, aim: Aim, cells = 1): Promise<Point | null> {
    const b = this.me().body;
    const eye = () => ({ x: b.x, y: b.y + eyeHeight(b), z: b.z });
    // From where the player stands: at rest on the ground (the aim is taken once for the whole
    // hold, so a body still sliding after a walk would carry the ray off the cell), neither in the
    // cell nor on it.
    const still = this.stepUntil(() => b.onGround && b.vx === 0 && b.vz === 0, REST_TICKS);
    const { x, y, z } = cell;
    const inTheWay = bodyInCell(this.view.entities, this.registry, x, y, z, cells + 1);
    const here = inTheWay || !still ? null : aim(eye());
    if (here) return here;
    const spot = standFor(this.view.world, this.registry, cell, this.feet(), aim);
    if (!spot) return null;
    const { stand } = spot;
    await this.port.travel(stand.x + 0.5, stand.y, stand.z + 0.5);
    const at = aim(eye());
    if (!at)
      throw new Error(`standing at ${cellText(stand)}, the walk does not see ${cellText(cell)}`);
    return at;
  }

  /**
   * Breaks a block by holding primary with the best tool that harvests it, standing where the eye
   * sees it; returns false when no stand around it does.
   */
  protected async breakAt(cell: Cell): Promise<boolean> {
    const state = this.blockAt(cell);
    const slot = this.toolFor(state);
    const at = await this.reach(cell, aimToBreak(this.view.world, this.registry, cell));
    if (!at) return false;
    const stack = this.me().inventory[slot];
    const item = stack ? this.registry.itemId(stack.item) : -1;
    const seconds = breakSeconds(this.registry, state, item, this.me().exhausted);
    const ticks = Math.ceil(seconds * TICKS_PER_SECOND * MINING_SLACK) + 1;
    await this.port.hold('primary', slot, at, ticks, () => this.blockAt(cell) !== state);
    if (this.blockAt(cell) !== state) return true;
    const b = this.me().body;
    const from = `${b.x.toFixed(2)}, ${b.y.toFixed(2)}, ${b.z.toFixed(2)}`;
    const key = this.registry.states[state]!.key;
    throw new Error(`${key} at ${cellText(cell)} did not break in ${ticks} ticks (from ${from})`);
  }

  /**
   * Places a block of an item (in the inventory) into a cell by secondary on a neighbour's face,
   * standing where the eye sees one; returns false when no stand around the cell does.
   */
  protected async placeAt(cell: Cell, item: string): Promise<boolean> {
    const slot = this.toHotbar(item);
    const places = this.registry.itemTables.places[this.registry.itemId(item)]!;
    const cells = this.registry.blockDef(places).placement?.tall ?? 1;
    const at = await this.reach(cell, aimToPlace(this.view.world, this.registry, cell), cells);
    if (!at) return false;
    const placed = () => blockItemKey(this.registry.blockDef(this.blockAt(cell)).key) === item;
    await this.port.hold('secondary', slot, at, 1, placed);
    if (!placed()) {
      const left = this.registry.states[this.blockAt(cell)]!.key;
      throw new Error(`placing ${item} at ${cellText(cell)} left ${left} there`);
    }
    return true;
  }

  /**
   * Picks up the drops of an item that a block or a creature left near `from`: those that fall in
   * reach come at once, else the walk goes onto the nearest one (a teleport onto it when the walk
   * does not get there, a drop in a pond or on a ledge, or when it lies lower than the feet).
   * Returns whether the count rose.
   */
  protected async pickUp(item: string, before: number, from: Point): Promise<boolean> {
    const more = () => this.count(item) > before;
    if (this.stepUntil(more, PICKUP_TICKS)) return true;
    const drop = this.dropNear(item, from);
    if (!drop) return false;
    // A walk only over firm ground: a drop below the feet or past a gap (a ravine, a pit) is
    // reached by a teleport instead of a fall.
    if (this.groundTo(drop)) {
      await this.port.hold('forward', this.emptyHand(), drop, WALK_TICKS, more);
      if (more()) return true;
    }
    await this.port.travel(drop.x, drop.y, drop.z);
    return this.stepUntil(more, PICKUP_TICKS);
  }

  /**
   * A blow at a creature with the weapon of a hotbar slot, once its cooldown is over: primary
   * pressed for a tick, the blow landing on the release.
   */
  protected async strike(id: number, slot: number): Promise<void> {
    const me = this.me();
    this.stepUntil(() => me.attackCooldown === 0, COOLDOWN_TICKS);
    const c = this.view.entities.get(id);
    if (c?.kind !== 'creature') return;
    const height = this.registry.creature(c.creature)!.hitbox[1];
    const at = { x: c.body.x, y: c.body.y + height * AIM_HEIGHT, z: c.body.z };
    await this.port.hold('primary', slot, at, 1);
  }

  /**
   * Whether the ground runs from the feet to a point no lower than the feet: every cell under the
   * straight line (a quarter block apart) is solid one or two blocks under the feet.
   */
  private groundTo(to: Point): boolean {
    const b = this.me().body;
    if (to.y < b.y - 1) return false;
    const feet = Math.floor(b.y);
    const steps = Math.ceil(Math.sqrt((to.x - b.x) ** 2 + (to.z - b.z) ** 2) * 4);
    for (let i = 1; i <= steps; i++) {
      const x = Math.floor(b.x + ((to.x - b.x) * i) / steps);
      const z = Math.floor(b.z + ((to.z - b.z) * i) / steps);
      const world = this.view.world;
      if (
        !solidAt(world, this.registry, { x, y: feet - 1, z }) &&
        !solidAt(world, this.registry, { x, y: feet - 2, z })
      )
        return false;
    }
    return true;
  }

  /** The nearest drop of an item within DROP_RADIUS of a point. */
  private dropNear(item: string, from: Point): Point | null {
    let best: Point | null = null;
    let bestDistance = DROP_RADIUS * DROP_RADIUS;
    for (const e of this.view.entities.values()) {
      if (e.kind !== 'itemDrop' || e.item !== item) continue;
      const d = (e.body.x - from.x) ** 2 + (e.body.y - from.y) ** 2 + (e.body.z - from.z) ** 2;
      if (d > bestDistance) continue;
      bestDistance = d;
      best = { x: e.body.x, y: e.body.y, z: e.body.z };
    }
    return best;
  }

  /**
   * The hotbar slot of the tool that harvests a block fastest (the highest tier of its kind), else
   * an empty hand when the hand harvests it.
   */
  private toolFor(state: number): number {
    const block = this.registry.blockDef(state);
    let best: { item: string; tier: number } | null = null;
    for (const stack of this.me().inventory) {
      const tool = stack ? this.registry.item(stack.item)?.tool : undefined;
      if (stack && tool && fitsTool(block, tool) && harvests(block, tool))
        if (!best || tool.tier > best.tier) best = { item: stack.item, tier: tool.tier };
    }
    if (best) return this.toHotbar(best.item);
    if (harvests(block, undefined)) return this.emptyHand();
    throw new Error(`nothing in the inventory harvests ${block.key}`);
  }
}
