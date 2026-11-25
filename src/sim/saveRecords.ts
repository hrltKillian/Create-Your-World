import { stationSlotCount } from '../content/crafting.ts';
import type { Registry } from '../content/registry.ts';
import { type BalanceDef, WEAR_SLOTS } from '../content/schema.ts';
import { isFiniteNumber, isPoint, isWhole } from '../core/guards.ts';
import { SAVE_VERSION } from '../world/codec/migrations.ts';
import { insideBorder, WORLD_HEIGHT } from '../world/coords.ts';
import { MET, STUDIED } from './bestiary.ts';
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
  freshNeeds,
  isHostile,
  PATH_MAX,
} from './creatures.ts';
import {
  isWaypointColour,
  isWaypointIcon,
  MAX_WAYPOINT_NAME,
  MAX_WAYPOINTS,
  WAYPOINT_ICONS,
  type Waypoint,
} from './exploration.ts';
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
import {
  createSkills,
  healthMax,
  SKILLS,
  type Skill,
  type Skills,
  type TaskState,
} from './progression.ts';
import type { QuestState } from './quests.ts';
import type { BlockEntityRecord, CreatureRecord, DropRecord, PlayerRecord } from './storage.ts';
import {
  clampGauge,
  createSurvival,
  DEATH_CAUSES,
  type DeathCause,
  GAUGES,
  type SurvivalState,
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
 * Whether a saved position lies inside the world: within its border and its height (`top`: by
 * default a jump from the top layer, 2 blocks of air above it).
 */
export function insideWorld(
  p: { readonly x: number; readonly y: number; readonly z: number },
  top = WORLD_HEIGHT + 2,
) {
  return insideBorder(p.x, p.z) && p.y >= 0 && p.y <= top;
}

/**
 * The highest saved drop kept as is: a stack thrown at a jump's apex from the top layer rises to
 * about WORLD_HEIGHT + 3.03 (feet + 1.26, eye 1.62 - 0.3, then vy up to 5). Anything higher is
 * crafted and brought down to it; normal play round-trips unchanged, so a resumed run matches.
 */
export const DROP_CEILING = WORLD_HEIGHT + 4;

/** A saved speed, never faster than a fall. */
const speed = (v: number) => Math.max(-PHYSICS.terminal, Math.min(PHYSICS.terminal, v));

/**
 * Reads a saved body onto `body` (its position and speeds), and returns whether it lies inside the
 * world. Speeds are cut to a fall's: a crafted one must not make the collision sweep endless.
 */
function readBody(
  body: { x: number; y: number; z: number; vx: number; vy: number; vz: number },
  saved: unknown,
  top?: number,
): boolean {
  assignFields(body, saved);
  body.vx = speed(body.vx);
  body.vy = speed(body.vy);
  body.vz = speed(body.vz);
  return insideWorld(body, top);
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
    cursor: player.cursor ? savedStack(player.cursor) : null,
    interaction: { ...player.interaction },
    craft: savedCraft(player.craft),
    seen: Object.keys(player.seen).sort(),
    survival: { ...player.survival },
    equipment: serializeInventory(player.equipment),
    respawn: player.respawn ? { ...player.respawn } : null,
    graves: player.graves.map((cell) => ({ ...cell })),
    quests: savedQuests(player.quests),
    pinned: player.pinned,
    biomes: Object.keys(player.biomes).sort(),
    xp: player.xp,
    skills: { ...player.skills },
    tasks: player.tasks.map((task) => ({ ...task })),
    taskDraws: player.taskDraws,
    rerollDay: player.rerollDay,
    explored: Object.keys(player.explored).sort(),
    waypoints: player.waypoints.map((w) => ({ ...w })),
    drank: player.drank,
    bestiary: { ...player.bestiary },
    fightTicks: player.fightTicks,
    invulnerable: player.invulnerable,
    attackCooldown: player.attackCooldown,
  };
}

/** A craft queue as saved: its reserved ingredients with text item keys. */
function savedCraft(queue: readonly CraftEntry[]): CraftEntry[] {
  return queue.map((entry) => ({ ...entry, reserved: savedStacks(entry.reserved) }));
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

/** The quests as saved: each state copied (insertion order kept: the unlock order). */
function savedQuests(quests: Readonly<Record<string, QuestState>>): Record<string, QuestState> {
  const out: Record<string, QuestState> = {};
  for (const key in quests) out[key] = { ...quests[key]! };
  return out;
}

/** Saved quests: malformed states are left out; quests of other packs are kept (they cost nothing). */
function readQuests(data: unknown): Record<string, QuestState> {
  const quests: Record<string, QuestState> = {};
  if (!data || typeof data !== 'object') return quests;
  for (const [key, value] of Object.entries(data)) {
    const { progress, done, claimed } = (value ?? {}) as Partial<QuestState>;
    if (!isWhole(progress, 0) || typeof done !== 'boolean' || typeof claimed !== 'boolean')
      continue;
    quests[key] = { progress, done, claimed: done && claimed };
  }
  return quests;
}

/** Saved skills: whole points within 0…`max` each, 0 for what is missing or malformed. */
function readSkills(data: unknown, max: number): Skills {
  const skills = createSkills();
  const saved = (data ?? {}) as Partial<Record<Skill, unknown>>;
  for (const skill of SKILLS) skills[skill] = wholeIn(saved[skill], 0, max, 0);
  return skills;
}

/** Saved waypoints: at most MAX_WAYPOINTS well-formed ones, inside the world's border. */
function readWaypoints(data: unknown): Waypoint[] {
  if (!Array.isArray(data)) return [];
  const waypoints: Waypoint[] = [];
  for (const saved of data.slice(0, MAX_WAYPOINTS) as Partial<Waypoint>[]) {
    const { name, x, z, icon, colour } = saved ?? {};
    if (typeof name !== 'string' || name.length > MAX_WAYPOINT_NAME) continue;
    if (!isWhole(x, -Infinity) || !isWhole(z, -Infinity) || !insideBorder(x, z)) continue;
    // A malformed symbol or colour falls back to the first ones.
    waypoints.push({
      name,
      x,
      z,
      icon: isWaypointIcon(icon) ? icon : WAYPOINT_ICONS[0],
      colour: isWaypointColour(colour) ? colour : 0,
    });
  }
  return waypoints;
}

/** Saved tasks: at most `held` well-formed ones (keys of other packs are dropped when drawn). */
function readTasks(data: unknown, held: number): TaskState[] {
  if (!Array.isArray(data)) return [];
  const tasks: TaskState[] = [];
  for (const saved of data.slice(0, held) as Partial<TaskState>[]) {
    if (typeof saved?.key !== 'string' || !isWhole(saved.progress, 0)) continue;
    tasks.push({ key: saved.key, progress: saved.progress });
  }
  return tasks;
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
function readSurvival(data: unknown, balance: BalanceDef, max: number): SurvivalState {
  const survival = assignFields(createSurvival(balance), data);
  survival.healthMax = max;
  for (const gauge of GAUGES)
    survival[gauge] = clampGauge(gauge, survival[gauge], balance, survival);
  // The hidden saturation never exceeds hunger; exhaustion is never negative (plan v3 « M30 »).
  survival.saturation = Math.max(0, Math.min(survival.hunger, survival.saturation));
  survival.exhaustion = Math.max(0, survival.exhaustion);
  const saved = (data ?? {}) as Partial<Record<keyof SurvivalState, unknown>>;
  if (DEATH_CAUSES.includes(saved.cause as DeathCause)) survival.cause = saved.cause as DeathCause;
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
  // Read into a copy: a body out of the world keeps the fresh one at the spawn (at rest, its fall
  // measured from there), none of the saved fall state.
  const body = { ...player.body };
  if (readBody(body, saved.body)) Object.assign(player.body, body);
  const { yaw, pitch, stamina, exhausted, restTicks, viewRadius } = saved;
  assignFields(player, { yaw, pitch, stamina, exhausted, restTicks, viewRadius });
  player.prevX = player.body.x;
  player.prevY = player.body.y;
  player.prevZ = player.body.z;
  player.input = { ...NEUTRAL_INPUT, yaw: player.yaw, pitch: player.pitch };
  player.inventory = deserializeInventory(saved.inventory, registry);
  // Without the screen it was on (screens are not saved): back in the inventory at the restore.
  player.cursor = readStack(saved.cursor, registry);
  assignFields(player.interaction, saved.interaction);
  player.craft = readCraft(saved.craft, registry);
  player.seen = readSeen(saved.seen);
  const balance = registry.pack.balance;
  player.skills = readSkills(saved.skills, balance.progression.maxSkill);
  player.survival = readSurvival(saved.survival, balance, healthMax(player.skills, balance));
  player.equipment = deserializeSlots(saved.equipment, WEAR_SLOTS.length, registry);
  player.respawn = readCell(saved.respawn);
  const graves = Array.isArray(saved.graves) ? saved.graves.map(readCell) : [];
  player.graves = graves.filter((cell) => cell !== null);
  player.quests = readQuests(saved.quests);
  player.pinned = typeof saved.pinned === 'string' ? saved.pinned : null;
  player.biomes = readSeen(saved.biomes);
  player.xp = wholeIn(saved.xp, 0, Number.MAX_SAFE_INTEGER, 0);
  player.tasks = readTasks(saved.tasks, balance.progression.tasks);
  player.taskDraws = wholeIn(saved.taskDraws, 0, Number.MAX_SAFE_INTEGER, 0);
  player.rerollDay = wholeIn(saved.rerollDay, -1, Number.MAX_SAFE_INTEGER, -1);
  player.explored = readSeen(saved.explored);
  player.waypoints = readWaypoints(saved.waypoints);
  player.drank = saved.drank === true;
  player.bestiary = readBestiary(saved.bestiary, registry);
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
  };
  if (drop.durability !== undefined) record.durability = drop.durability;
  return record;
}

/** The drop of a (migrated) record, or null if it is malformed, below the world or past its border. */
export function readDrop(data: unknown, registry: Registry): ItemDropState | null {
  const saved = (data ?? {}) as Partial<DropRecord>;
  if (saved.kind !== 'itemDrop' || !isWhole(saved.id, 1) || typeof saved.item !== 'string')
    return null;
  if (!isWhole(saved.count, 1) || !isPoint(saved.body)) return null;
  const body: DropBody = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: false };
  // A thrown drop flies higher than a player: only a crafted height is brought down, never lost.
  const savedBody = { ...saved.body, y: Math.min(saved.body.y, DROP_CEILING) };
  if (!readBody(body, savedBody, DROP_CEILING)) return null;
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
  };
  if (isWhole(saved.durability, 0)) drop.durability = saved.durability;
  loadItemKey(drop, registry);
  return drop;
}

export function creatureRecord(c: Readonly<CreatureState>): CreatureRecord {
  const { prevX, prevY, prevZ, prevYaw, ...record } = c;
  return { ...record, body: { ...c.body }, path: c.path.slice(0, c.pathLength * 3) };
}

/** A saved bestiary: the pack's creatures only, each MET or STUDIED. */
function readBestiary(data: unknown, registry: Registry): Record<string, number> {
  const bestiary: Record<string, number> = {};
  if (typeof data !== 'object' || data === null) return bestiary;
  for (const [key, level] of Object.entries(data))
    if (registry.creature(key) && (level === MET || level === STUDIED)) bestiary[key] = level;
  return bestiary;
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
    ...freshNeeds(def, body.y),
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
  c.stamina = Math.max(0, Math.min(def.stamina.runSeconds, c.stamina));
  c.hunger = Math.max(0, Math.min(100, c.hunger));
  c.thirst = Math.max(0, Math.min(100, c.thirst));
  c.lostTicks = wholeIn(c.lostTicks, -1, MODE_TICKS_MAX, -1);
  c.chaseTicks = wholeIn(c.chaseTicks, 0, MODE_TICKS_MAX, 0);
  c.calmTicks = wholeIn(c.calmTicks, 0, MODE_TICKS_MAX, 0);
  c.waryTicks = wholeIn(c.waryTicks, 0, MODE_TICKS_MAX, 0);
  c.hopTicks = wholeIn(c.hopTicks, 0, MODE_TICKS_MAX, 0);
  c.seek = wholeIn(c.seek, 0, 2, 0);
  c.airTop = Math.max(c.airTop, c.body.y);
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
  if (entity.kind === 'workbench')
    return { ...entity, slots: savedSlots(entity.slots), craft: savedCraft(entity.craft) };
  return { ...entity, slots: savedSlots(entity.slots) };
}

/** Most slots a saved block entity may have (a pack holds as many as a dead player's stacks). */
const MAX_SLOTS = 256;

/**
 * The block entity of a (migrated) record, or null if it is malformed. Unknown items keep their
 * key; a station or workbench of a station the pack lacks, and a pack, keep their slots (the
 * former no longer run, but spill them when broken; a workbench's entries of recipes the pack
 * lacks drop their ingredients when it next ticks). `lastTick` is the column record's, for
 * stations saved without their own tick.
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
  if (typeof saved.station !== 'string') return null;
  const def = registry.crafting.station(saved.station);
  const tick = isWhole(saved.tick, 0) ? saved.tick : lastTick;
  if (saved.kind === 'workbench') {
    const size = def ? def.outputSlots : Math.min(slots.length, MAX_SLOTS);
    const craft = (saved as { craft?: unknown }).craft;
    return {
      kind: 'workbench',
      x,
      y,
      z,
      station: saved.station,
      slots: deserializeSlots(slots, size, registry),
      craft: readCraft(craft, registry),
      tick,
    };
  }
  if (saved.kind !== 'station') return null;
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
    // Only a fire that may be kept burning keeps the toggle on.
    keepLit: saved.keepLit === true && def?.keepLit === true,
    tick,
  };
}
