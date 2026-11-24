import { stationSlotCount } from '../content/crafting.ts';
import type { Registry } from '../content/registry.ts';
import { type BalanceDef, WEAR_SLOTS } from '../content/schema.ts';
import { isFiniteNumber, isPoint, isWhole } from '../core/guards.ts';
import { SAVE_VERSION } from '../world/codec/migrations.ts';
import { insideBorder, WORLD_HEIGHT } from '../world/coords.ts';
import { type BlockEntity, CONTAINER_SLOTS, type StationEntity } from './blockEntities.ts';
import { ticksOf } from './clock.ts';
import { COMBAT } from './combat.ts';
import { NEUTRAL_INPUT } from './commands.ts';
import { CRAFT_QUEUE, type CraftEntry, MAX_CRAFT_COUNT } from './craftQueue.ts';
import {
  CREATURE_MODES,
  type CreatureBody,
  type CreatureMode,
  type CreatureState,
  isHostile,
  PATH_MAX,
} from './creatures.ts';
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
import { PHYSICS } from './physics.ts';
import { type BlockCell, createPlayer, type PlayerState } from './player.ts';
import { SHELTERS, type Shelter } from './shelter.ts';
import type { BlockEntityRecord, CreatureRecord, DropRecord, PlayerRecord } from './storage.ts';
import {
  clampGauge,
  createSurvival,
  DEATH_CAUSES,
  type DeathCause,
  EFFECT_KEYS,
  type EffectKey,
  GAUGES,
  type SurvivalState,
  type TimedEffect,
} from './survival.ts';

/**
 * Save records of entities (docs « Sauvegarde »): players, item drops, creatures and block
 * entities, with text item keys. Readers never trust a record: a malformed field keeps its default
 * (a new player at the spawn), a malformed drop, creature or block entity is dropped.
 */

/**
 * Copies the number and boolean fields of `saved` onto those of `target` when they have the same
 * type (a finite number on a number, a boolean on a boolean); fields of other types (text, lists)
 * are left for the caller to read.
 */
function assignFields<T extends object>(target: T, saved: unknown): T {
  if (!saved || typeof saved !== 'object') return target;
  const from = saved as Record<string, unknown>;
  const to = target as Record<string, unknown>;
  for (const key of Object.keys(to)) {
    const value = from[key];
    const kind = typeof to[key];
    const fits =
      kind === 'boolean' ? typeof value === 'boolean' : kind === 'number' && isFiniteNumber(value);
    if (fits) to[key] = value;
  }
  return target;
}

/** A saved whole number within [min, max] (cut down to max, a safe integer), else `fallback`. */
function wholeIn(value: unknown, min: number, max: number, fallback: number): number {
  const whole = typeof value === 'number' && Number.isInteger(value) && value >= min;
  return whole ? Math.min(value, max, Number.MAX_SAFE_INTEGER) : fallback;
}

/**
 * Whether a saved position lies inside the world: within its border and its height, a jump from
 * the top layer included (2 blocks of air above it).
 */
export function insideWorld(p: { readonly x: number; readonly y: number; readonly z: number }) {
  return insideBorder(p.x, p.z) && p.y >= 0 && p.y <= WORLD_HEIGHT + 2;
}

/** A saved speed, never faster than a fall. */
const speed = (v: number) => Math.max(-PHYSICS.terminal, Math.min(PHYSICS.terminal, v));

/**
 * Reads a saved body onto `body` (its position and speeds), and returns whether it lies inside the
 * world. Speeds are cut to a fall's: a crafted one must not make the collision sweep endless.
 */
function readBody(
  body: { x: number; y: number; z: number; vx: number; vy: number; vz: number },
  saved: unknown,
): boolean {
  assignFields(body, saved);
  body.vx = speed(body.vx);
  body.vy = speed(body.vy);
  body.vz = speed(body.vz);
  return insideWorld(body);
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
    survival: { ...player.survival, effects: player.survival.effects.map((e) => ({ ...e })) },
    equipment: serializeInventory(player.equipment),
    respawn: player.respawn ? { ...player.respawn } : null,
    graves: player.graves.map((cell) => ({ ...cell })),
    objectives: [...player.objectives],
    drank: player.drank,
    fightTicks: player.fightTicks,
    invulnerable: player.invulnerable,
    attackCooldown: player.attackCooldown,
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

/** The strings of a saved list (keys of other packs are kept: they cost nothing). */
function readKeys(data: unknown): string[] {
  return Array.isArray(data) ? data.filter((key): key is string => typeof key === 'string') : [];
}

/** A saved seen set. */
function readSeen(data: unknown): Record<string, true> {
  const seen: Record<string, true> = {};
  for (const key of readKeys(data)) seen[key] = true;
  return seen;
}

/** A saved block cell, or null unless its coordinates are whole and inside the world. */
function readCell(data: unknown): BlockCell | null {
  const { x, y, z } = (data ?? {}) as Partial<Record<keyof BlockCell, unknown>>;
  if (!isWhole(x, -Infinity) || !isWhole(y, 0) || y >= WORLD_HEIGHT || !isWhole(z, -Infinity))
    return null;
  return insideBorder(x, z) ? { x, y, z } : null;
}

/**
 * A saved survival state: full gauges for what is missing or malformed, the gauges kept within
 * their ranges.
 */
function readSurvival(data: unknown, balance: BalanceDef): SurvivalState {
  const survival = assignFields(createSurvival(balance), data);
  for (const gauge of GAUGES) survival[gauge] = clampGauge(gauge, survival[gauge], balance);
  const saved = (data ?? {}) as Partial<Record<keyof SurvivalState, unknown>>;
  if (SHELTERS.includes(saved.shelter as Shelter)) survival.shelter = saved.shelter as Shelter;
  if (DEATH_CAUSES.includes(saved.cause as DeathCause)) survival.cause = saved.cause as DeathCause;
  for (const effect of Array.isArray(saved.effects) ? saved.effects : []) {
    const { key, ticks } = (effect ?? {}) as Partial<TimedEffect>;
    if (EFFECT_KEYS.includes(key as EffectKey) && isWhole(ticks, 1))
      survival.effects.push({ key: key as EffectKey, ticks });
  }
  return survival;
}

/**
 * The player of a (migrated) record, or null without a valid connection and entity id. Its
 * position defaults to the spawn point (also for a body out of the world); it holds still until
 * its first command.
 */
export function readPlayer(
  data: unknown,
  registry: Registry,
  spawn: { readonly x: number; readonly y: number; readonly z: number },
): PlayerState | null {
  const saved = (data ?? {}) as Partial<PlayerRecord>;
  if (!isWhole(saved.playerId, 0) || !isWhole(saved.id, 1)) return null;
  const { x, y, z } = spawn;
  const player = createPlayer(saved.playerId, x, y, z, 6, registry.pack.balance, saved.id);
  if (!readBody(player.body, saved.body)) {
    player.body.x = x;
    player.body.y = y;
    player.body.z = z;
  }
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
  player.survival = readSurvival(saved.survival, registry.pack.balance);
  player.equipment = deserializeSlots(saved.equipment, WEAR_SLOTS.length, registry);
  player.respawn = readCell(saved.respawn);
  const graves = Array.isArray(saved.graves) ? saved.graves.map(readCell) : [];
  player.graves = graves.filter((cell) => cell !== null);
  player.objectives = readKeys(saved.objectives);
  player.drank = saved.drank === true;
  // A fight in progress (no field before version 5: none).
  player.fightTicks = wholeIn(saved.fightTicks, 0, COMBAT.fightTicks, 0);
  player.invulnerable = wholeIn(saved.invulnerable, 0, COMBAT.playerInvulnerableTicks, 0);
  player.attackCooldown = wholeIn(saved.attackCooldown, 0, longestCooldown(registry), 0);
  return player;
}

/** The longest weapon cooldown of the pack, the bare hand's included (ticks). */
function longestCooldown(registry: Registry): number {
  let longest = ticksOf(registry.pack.balance.combat.hand.cooldown);
  for (const item of registry.items)
    if (item.weapon) longest = Math.max(longest, ticksOf(item.weapon.cooldown));
  return longest;
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

/** The drop of a (migrated) record, or null if it is malformed or out of the world. */
export function readDrop(data: unknown, registry: Registry): ItemDropState | null {
  const saved = (data ?? {}) as Partial<DropRecord>;
  if (saved.kind !== 'itemDrop' || !isWhole(saved.id, 1) || typeof saved.item !== 'string')
    return null;
  if (!isWhole(saved.count, 1) || !isPoint(saved.body)) return null;
  const body: DropBody = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: false };
  if (!readBody(body, saved.body)) return null;
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

export function creatureRecord(c: Readonly<CreatureState>): CreatureRecord {
  const { prevX, prevY, prevZ, prevYaw, ...record } = c;
  return { ...record, body: { ...c.body }, path: c.path.slice(0, c.pathLength * 3) };
}

/** No timed mode lasts a minute (a walk, the longest, lasts 10 s): a saved timer is cut to it. */
const MODE_TICKS_MAX = ticksOf(60);

/**
 * The creature of a (migrated) record, or null when it is malformed, out of the world, of a
 * creature the pack lacks, or hostile (hostiles are never saved). `tick` is the world's.
 */
export function readCreature(
  data: unknown,
  registry: Registry,
  tick: number,
): CreatureState | null {
  const saved = (data ?? {}) as Partial<Record<keyof CreatureRecord, unknown>>;
  if (saved.kind !== 'creature' || !isWhole(saved.id, 1) || typeof saved.creature !== 'string')
    return null;
  const def = registry.creature(saved.creature);
  if (!def || isHostile(def) || !isPoint(saved.body)) return null;
  const body: CreatureBody = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: false };
  if (!readBody(body, saved.body)) return null;
  const path = Array.isArray(saved.path) ? saved.path.slice(0, PATH_MAX * 3) : [];
  const cells = path.every((v) => isWhole(v, -Infinity)) ? Math.floor(path.length / 3) : 0;
  const c: CreatureState = {
    kind: 'creature',
    id: saved.id,
    creature: def.key,
    body,
    prevX: body.x,
    prevY: body.y,
    prevZ: body.z,
    prevYaw: 0,
    yaw: 0,
    health: def.health,
    mode: CREATURE_MODES.includes(saved.mode as CreatureMode)
      ? (saved.mode as CreatureMode)
      : 'idle',
    modeTicks: 0,
    target: -1,
    goalX: body.x,
    goalY: body.y,
    goalZ: body.z,
    path: path.slice(0, cells * 3) as number[],
    pathLength: cells,
    pathStep: 0,
    planTick: -1,
    planX: 0,
    planZ: 0,
    cooldown: 0,
    invulnerable: 0,
    sees: false,
    watched: false,
    unseen: 0,
    herd: saved.id,
    cave: false,
  };
  // Every number and flag of the record that has the right type (the path's length: its cells),
  // the counters, timers and ids within their ranges: a crafted save must neither hang the path
  // walk nor freeze a creature for good.
  assignFields(c, saved);
  c.pathLength = cells;
  c.pathStep = wholeIn(c.pathStep, 0, PATH_MAX, 0);
  c.modeTicks = wholeIn(c.modeTicks, 0, MODE_TICKS_MAX, 0);
  c.cooldown = wholeIn(c.cooldown, 0, def.attack ? ticksOf(def.attack.cooldown) : 0, 0);
  c.invulnerable = wholeIn(c.invulnerable, 0, COMBAT.creatureInvulnerableTicks, 0);
  c.unseen = wholeIn(c.unseen, 0, Number.POSITIVE_INFINITY, 0);
  c.planTick = wholeIn(c.planTick, -1, tick, -1);
  c.target = wholeIn(c.target, -1, Number.POSITIVE_INFINITY, -1);
  c.herd = wholeIn(c.herd, 1, Number.POSITIVE_INFINITY, c.id);
  if (c.health <= 0 || c.mode === 'dying') return null;
  c.health = Math.min(c.health, def.health);
  c.prevYaw = c.yaw;
  return c;
}

/** The slots of a block entity as saved (text item keys). */
const savedSlots = (slots: Inventory): Inventory =>
  slots.map((stack) => (stack ? savedStack(stack) : null));

export function blockEntityRecord(entity: Readonly<BlockEntity>): BlockEntityRecord {
  if (entity.kind === 'grave')
    return { ...entity, slots: savedSlots(entity.slots), worn: savedSlots(entity.worn) };
  return { ...entity, slots: savedSlots(entity.slots) };
}

/** Most slots a saved block entity may have (a pack holds as many as a dead player's stacks). */
const MAX_SLOTS = 256;

/**
 * The block entity of a (migrated) record, or null if it is malformed. Unknown items keep their
 * key; a station of a station the pack lacks, and a pack, keep their slots (the former no longer
 * runs, but spills them when broken). `lastTick` is the column record's, for stations saved
 * without their own tick.
 */
export function readBlockEntity(
  data: unknown,
  registry: Registry,
  lastTick: number,
): BlockEntity | null {
  const saved = (data ?? {}) as Partial<Record<keyof StationEntity, unknown>>;
  const cell = readCell(saved);
  if (!cell) return null;
  const { x, y, z } = cell;
  const slots = Array.isArray(saved.slots) ? saved.slots : [];
  if (saved.kind === 'container')
    return {
      kind: 'container',
      x,
      y,
      z,
      slots: deserializeSlots(slots, CONTAINER_SLOTS, registry),
    };
  if (saved.kind === 'grave') {
    const size = Math.min(slots.length, MAX_SLOTS);
    // A pack saved before the worn items were kept apart holds them among its slots.
    const worn = (saved as { worn?: unknown }).worn;
    return {
      kind: 'grave',
      x,
      y,
      z,
      slots: deserializeSlots(slots, size, registry),
      worn: deserializeSlots(Array.isArray(worn) ? worn : [], WEAR_SLOTS.length, registry),
    };
  }
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
