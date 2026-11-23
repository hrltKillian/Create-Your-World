import type { Registry } from '../content/registry.ts';
import { SAVE_VERSION } from '../world/codec/migrations.ts';
import { NEUTRAL_INPUT } from './commands.ts';
import {
  deserializeInventory,
  loadItemKey,
  savedItemKey,
  serializeInventory,
} from './inventory.ts';
import type { DropBody, ItemDropState } from './itemDrops.ts';
import { createPlayer, type PlayerState } from './player.ts';
import type { DropRecord, PlayerRecord } from './storage.ts';

/**
 * Save records of entities (docs « Sauvegarde »): players and item drops, with text item keys.
 * Readers never trust a record: a malformed field keeps its default (a new player at the spawn),
 * a malformed drop is dropped.
 */

const isWhole = (v: unknown, min: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min;
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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
  };
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
  const at = (saved.body ?? {}) as Partial<DropBody>;
  if (saved.kind !== 'itemDrop' || !isWhole(saved.id, 1) || typeof saved.item !== 'string')
    return null;
  if (!isWhole(saved.count, 1) || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return null;
  if (!isFiniteNumber(at.z)) return null;
  const body: DropBody = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: false };
  assignFields(body, at);
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
