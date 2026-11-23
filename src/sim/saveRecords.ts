import { stationSlotCount } from '../content/crafting.ts';
import type { Registry } from '../content/registry.ts';
import { isFiniteNumber, isPoint, isWhole } from '../core/guards.ts';
import { SAVE_VERSION } from '../world/codec/migrations.ts';
import { WORLD_HEIGHT } from '../world/coords.ts';
import { type BlockEntity, CONTAINER_SLOTS, type StationEntity } from './blockEntities.ts';
import { NEUTRAL_INPUT } from './commands.ts';
import { CRAFT_QUEUE, type CraftEntry, MAX_CRAFT_COUNT } from './craftQueue.ts';
import {
  deserializeInventory,
  deserializeSlots,
  type Inventory,
  loadItemKey,
  readStack,
  savedItemKey,
  savedStack,
  serializeInventory,
} from './inventory.ts';
import type { DropBody, ItemDropState } from './itemDrops.ts';
import { createPlayer, type PlayerState } from './player.ts';
import type { BlockEntityRecord, DropRecord, PlayerRecord } from './storage.ts';

/**
 * Save records of entities (docs « Sauvegarde »): players, item drops and block entities, with text
 * item keys. Readers never trust a record: a malformed field keeps its default (a new player at
 * the spawn), a malformed drop or block entity is dropped.
 */

/** Copies the fields of `saved` that have the type of `target`'s (finite numbers, booleans). */
function assignFields<T extends object>(target: T, saved: unknown): T {
  if (!saved || typeof saved !== 'object') return target;
  const from = saved as Record<string, unknown>;
  const to = target as Record<string, unknown>;
  for (const key of Object.keys(to)) {
    const value = from[key];
    const fits = typeof to[key] === 'boolean' ? typeof value === 'boolean' : isFiniteNumber(value);
    if (fits) to[key] = value;
  }
  return target;
}

export function playerRecord(worldId: string, player: Readonly<PlayerState>): PlayerRecord {
  return {
    worldId,
    playerId: player.playerId,
    v: SAVE_VERSION,
    id: player.id,
    body: { ...player.body },
    yaw: player.yaw,
    pitch: player.pitch,
    stamina: player.stamina,
    exhausted: player.exhausted,
    restTicks: player.restTicks,
    viewRadius: player.viewRadius,
    inventory: serializeInventory(player.inventory),
    interaction: { ...player.interaction },
    craft: player.craft.map((entry) => ({ ...entry, reserved: savedStacks(entry.reserved) })),
    seen: Object.keys(player.seen).sort(),
  };
}

/** The stacks of a slot array as saved, empty slots left out. */
function savedStacks(slots: Inventory): Inventory {
  const out: Inventory = [];
  for (const stack of slots) if (stack) out.push(savedStack(stack));
  return out;
}

/**
 * A saved craft queue: malformed entries are left out (their ingredients with them); an entry
 * whose recipe the pack lacks is kept, to be refunded once the player is in the world.
 */
function readCraft(data: unknown, registry: Registry): CraftEntry[] {
  if (!Array.isArray(data)) return [];
  const queue: CraftEntry[] = [];
  for (const saved of data.slice(0, CRAFT_QUEUE) as Partial<CraftEntry>[]) {
    if (!saved || typeof saved.recipe !== 'string' || !isWhole(saved.count, 1)) continue;
    const reserved: Inventory = [];
    for (const stack of Array.isArray(saved.reserved) ? saved.reserved : []) {
      const read = readStack(stack, registry);
      if (read) reserved.push(read);
    }
    queue.push({
      recipe: saved.recipe,
      count: Math.min(saved.count, MAX_CRAFT_COUNT),
      progressTicks: isWhole(saved.progressTicks, 0) ? saved.progressTicks : 0,
      reserved,
    });
  }
  return queue;
}

/** A saved seen set (keys of other packs are kept: they cost nothing). */
function readSeen(data: unknown): Record<string, true> {
  const seen: Record<string, true> = {};
  if (Array.isArray(data)) for (const key of data) if (typeof key === 'string') seen[key] = true;
  return seen;
}

/**
 * The player of a (migrated) record, or null without a valid connection and entity id. Its
 * position defaults to the spawn point; it holds still until its first command.
 */
export function readPlayer(
  data: unknown,
  registry: Registry,
  spawn: { readonly x: number; readonly y: number; readonly z: number },
): PlayerState | null {
  const saved = (data ?? {}) as Partial<PlayerRecord>;
  if (!isWhole(saved.playerId, 0) || !isWhole(saved.id, 1)) return null;
  const player = createPlayer(saved.playerId, spawn.x, spawn.y, spawn.z, 6, saved.id);
  assignFields(player.body, saved.body);
  const { yaw, pitch, stamina, exhausted, restTicks, viewRadius } = saved;
  assignFields(player, { yaw, pitch, stamina, exhausted, restTicks, viewRadius });
  player.prevX = player.body.x;
  player.prevY = player.body.y;
  player.prevZ = player.body.z;
  player.input = { ...NEUTRAL_INPUT, yaw: player.yaw, pitch: player.pitch };
  player.inventory = deserializeInventory(saved.inventory, registry);
  assignFields(player.interaction, saved.interaction);
  player.craft = readCraft(saved.craft, registry);
  player.seen = readSeen(saved.seen);
  return player;
}

export function dropRecord(drop: Readonly<ItemDropState>): DropRecord {
  const record: DropRecord = {
    kind: 'itemDrop',
    id: drop.id,
    item: savedItemKey(drop),
    count: drop.count,
    body: { ...drop.body },
    age: drop.age,
    pickupDelay: drop.pickupDelay,
    thrower: drop.thrower,
  };
  if (drop.durability !== undefined) record.durability = drop.durability;
  return record;
}

/** The drop of a (migrated) record, or null if it is malformed. */
export function readDrop(data: unknown, registry: Registry): ItemDropState | null {
  const saved = (data ?? {}) as Partial<DropRecord>;
  if (saved.kind !== 'itemDrop' || !isWhole(saved.id, 1) || typeof saved.item !== 'string')
    return null;
  if (!isWhole(saved.count, 1) || !isPoint(saved.body)) return null;
  const body: DropBody = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: false };
  assignFields(body, saved.body);
  const drop: ItemDropState = {
    kind: 'itemDrop',
    id: saved.id,
    item: saved.item,
    count: saved.count,
    body,
    prevX: body.x,
    prevY: body.y,
    prevZ: body.z,
    age: isWhole(saved.age, 0) ? saved.age : 0,
    pickupDelay: isWhole(saved.pickupDelay, 0) ? saved.pickupDelay : 0,
    thrower: isWhole(saved.thrower, -1) ? saved.thrower : -1,
  };
  if (isWhole(saved.durability, 0)) drop.durability = saved.durability;
  loadItemKey(drop, registry);
  return drop;
}

export function blockEntityRecord(entity: Readonly<BlockEntity>): BlockEntityRecord {
  return { ...entity, slots: entity.slots.map((stack) => (stack ? savedStack(stack) : null)) };
}

/** Most slots a saved block entity may have. */
const MAX_SLOTS = 64;

/**
 * The block entity of a (migrated) record, or null if it is malformed. Unknown items keep their
 * key; a station of a station the pack lacks keeps its slots (it no longer runs, but spills them
 * when broken). `lastTick` is the column record's, for stations saved without their own tick.
 */
export function readBlockEntity(
  data: unknown,
  registry: Registry,
  lastTick: number,
): BlockEntity | null {
  const saved = (data ?? {}) as Partial<Record<keyof StationEntity, unknown>>;
  const { x, y, z } = saved;
  if (!isWhole(x, -Infinity) || !isWhole(y, 0) || y >= WORLD_HEIGHT || !isWhole(z, -Infinity))
    return null;
  const slots = Array.isArray(saved.slots) ? saved.slots : [];
  if (saved.kind === 'container')
    return {
      kind: 'container',
      x,
      y,
      z,
      slots: deserializeSlots(slots, CONTAINER_SLOTS, registry),
    };
  if (saved.kind !== 'station' || typeof saved.station !== 'string') return null;
  const def = registry.crafting.station(saved.station);
  const size = def ? stationSlotCount(def) : Math.min(slots.length, MAX_SLOTS);
  const whole = (v: unknown) => (isWhole(v, 0) ? v : 0);
  return {
    kind: 'station',
    x,
    y,
    z,
    station: saved.station,
    slots: deserializeSlots(slots, size, registry),
    burnTicksLeft: whole(saved.burnTicksLeft),
    burnTicks: whole(saved.burnTicks),
    progressTicks: whole(saved.progressTicks),
    process: typeof saved.process === 'string' ? saved.process : '',
    lit: saved.lit === true,
    tick: isWhole(saved.tick, 0) ? saved.tick : lastTick,
  };
}
