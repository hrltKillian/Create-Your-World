import type { Registry } from '../content/registry.ts';
import { type BalanceDef, WEAR_SLOTS } from '../content/schema.ts';
import { isWhole } from '../core/guards.ts';
import { SAVE_VERSION } from '../world/codec/migrations.ts';
import { insideBorder } from '../world/coords.ts';
import { MET, STUDIED } from './bestiary.ts';
import { ticksOf } from './clock.ts';
import { COMBAT } from './combat.ts';
import { NEUTRAL_INPUT } from './commands.ts';
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
  readStack,
  savedStack,
  serializeInventory,
} from './inventory.ts';
import { createPlayer, type PlayerState } from './player.ts';
import {
  createSkills,
  healthMax,
  SKILLS,
  type Skill,
  type Skills,
  type TaskState,
} from './progression.ts';
import type { QuestState } from './quests.ts';
import {
  assignFields,
  readBody,
  readCell,
  readCraft,
  readSeen,
  savedCraft,
  wholeIn,
} from './saveRecords.ts';
import type { PlayerRecord } from './storage.ts';
import {
  clampGauge,
  createSurvival,
  DEATH_CAUSES,
  type DeathCause,
  GAUGES,
  type SurvivalState,
} from './survival.ts';

/**
 * The save record of a player (docs « Sauvegarde »), with text item keys: its body, inventory,
 * survival, progress, quests and map. Reading never trusts it: a malformed field keeps its
 * default (a new player at the spawn). The other entities' records are saveRecords.ts's, whose
 * field readers this module shares.
 */

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

/** A saved bestiary: the pack's creatures only, each MET or STUDIED. */
function readBestiary(data: unknown, registry: Registry): Record<string, number> {
  const bestiary: Record<string, number> = {};
  if (typeof data !== 'object' || data === null) return bestiary;
  for (const [key, level] of Object.entries(data))
    if (registry.creature(key) && (level === MET || level === STUDIED)) bestiary[key] = level;
  return bestiary;
}
