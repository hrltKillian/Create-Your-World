import type { QuestCondition, QuestCounter, QuestDef, TaskDef } from '../content/schema.ts';
import { MET } from '../core/creatures.ts';
import { WORLD_HEIGHT } from '../world/coords.ts';
import { withinReach } from './blockEntities.ts';
import { TICKS_PER_SECOND } from './clock.ts';
import { reject } from './commandRules.ts';
import type { QuestCommand } from './commands.ts';
import { biomeAt } from './environment.ts';
import type { SimEvent } from './events.ts';
import { freshStack } from './inventory.ts';
import { giveItems } from './inventoryCommands.ts';
import { bodyHeight } from './physics.ts';
import type { PlayerState } from './player.ts';
import { fillTasks, gainXp } from './progression.ts';
import type { Simulation } from './Simulation.ts';

/*
 * Quests (plan v3 « M21 », tick step 16): a graph in the pack's data. A quest exists for a player
 * once every quest it requires is done; a counter then counts the player's deeds of this tick on
 * (creatures killed, nights survived, blocks broken or placed, items consumed: tasks too), and a condition (items had, stations near, a drink, biomes
 * walked, creatures met) is read once a second, so a state already reached does the quest as soon
 * as it unlocks (`questDone` with `already`). The pack lists each quest after those it requires:
 * one pass unlocks and does a whole chain. A quest done waits to be claimed for its rewards
 * (`quest.claim`, with its XP: progression.ts); one may be pinned to the compass (`quest.pin`). Nothing is allocated per tick
 * but a quest's first state.
 */

/** A player's state of a quest unlocked. */
export interface QuestState {
  /** Events counted since the unlock (counters). */
  progress: number;
  done: boolean;
  /** Its rewards were given. */
  claimed: boolean;
}

/** A quest's station counts within this distance of the player (blocks). */
export const STATION_REACH = 4;

/**
 * Whether a block of a station stands within STATION_REACH of the player (the cells around them
 * are read: placed, generated or filled blocks all count, and nothing is left to keep in sync).
 */
export function stationNear(sim: Simulation, player: PlayerState, station: string): boolean {
  const b = player.body;
  const r = STATION_REACH;
  const y0 = Math.max(0, Math.floor(b.y - r));
  const y1 = Math.min(WORLD_HEIGHT - 1, Math.floor(b.y + bodyHeight(b) + r));
  for (let x = Math.floor(b.x - r); x <= Math.floor(b.x + r); x++) {
    for (let z = Math.floor(b.z - r); z <= Math.floor(b.z + r); z++) {
      for (let y = y0; y <= y1; y++) {
        const def = sim.registry.blockDef(sim.world.getBlock(x, y, z));
        if (def.station === station && withinReach(player, x, y, z, r)) return true;
      }
    }
  }
  return false;
}

/** How many keys a record holds (no array made). */
function keysIn(record: Readonly<Record<string, unknown>>, min = 0): number {
  let n = 0;
  for (const key in record) if ((record[key] as number) >= min) n++;
  return n;
}

/** Whether every part of a quest's condition holds for a player now. */
export function conditionHolds(
  sim: Simulation,
  player: PlayerState,
  condition: QuestCondition,
): boolean {
  const items = condition.items;
  if (items) for (const item of items) if (player.seen[item] !== true) return false;
  if (condition.drank && !player.drank) return false;
  if (condition.biomes !== undefined && keysIn(player.biomes) < condition.biomes) return false;
  if (condition.met !== undefined && keysIn(player.bestiary, MET) < condition.met) return false;
  const stations = condition.stations;
  if (stations)
    for (const station of stations) if (!stationNear(sim, player, station)) return false;
  return true;
}

/** Whether every quest a quest requires is done. */
function unlockedFor(player: PlayerState, quest: QuestDef): boolean {
  const requires = quest.requires;
  if (requires) for (const key of requires) if (player.quests[key]?.done !== true) return false;
  return true;
}

function complete(
  player: PlayerState,
  state: QuestState,
  quest: QuestDef,
  already: boolean,
  out: SimEvent[],
): void {
  state.done = true;
  out.push({ type: 'questDone', playerId: player.playerId, quest: quest.key, already });
}

/** The deed an event is for a player (and its target in `deed`), or '' when none. */
const deed = { event: '', target: '' };
function deedOf(sim: Simulation, player: PlayerState, e: SimEvent): boolean {
  deed.target = '';
  if (e.type === 'creatureDied' && e.attacker === player.id) {
    deed.event = 'killed';
    deed.target = e.creature;
  } else if (e.type === 'nightSurvived') deed.event = 'night';
  else if (!('playerId' in e) || e.playerId !== player.playerId) return false;
  else if (e.type === 'blockBroken' || e.type === 'blockPlaced') {
    deed.event = e.type === 'blockBroken' ? 'broken' : 'placed';
    deed.target = sim.registry.blockDef(e.state).key;
  } else if (e.type === 'consumed') {
    deed.event = 'consumed';
    deed.target = e.item;
  } else return false;
  return true;
}

/** Whether a counter counts the deed in `deed`. */
function counts(counter: QuestCounter): boolean {
  return (
    counter.event === deed.event && (counter.target === undefined || counter.target === deed.target)
  );
}

/** Counts this tick's deeds (events from `first` to `last`) for a player's quests and tasks. */
function countDeeds(
  sim: Simulation,
  player: PlayerState,
  out: SimEvent[],
  first: number,
  last: number,
): void {
  const quests = sim.registry.pack.quests ?? [];
  const tasks = sim.registry.pack.tasks ?? [];
  for (let i = first; i < last; i++) {
    if (!deedOf(sim, player, out[i]!)) continue;
    for (const quest of quests) {
      const counter = quest.counter;
      const state = player.quests[quest.key];
      if (!counter || !state || state.done || !counts(counter)) continue;
      state.progress++;
      out.push({
        type: 'questProgress',
        playerId: player.playerId,
        quest: quest.key,
        progress: state.progress,
      });
      if (state.progress >= counter.count) complete(player, state, quest, false, out);
    }
    for (const held of player.tasks) {
      let task: TaskDef | undefined;
      for (const def of tasks) if (def.key === held.key) task = def;
      if (!task || held.progress >= task.counter.count || !counts(task.counter)) continue;
      held.progress++;
      out.push({
        type: 'taskProgress',
        playerId: player.playerId,
        task: task.key,
        progress: held.progress,
      });
    }
  }
}

/** Unlocks what can be, and does the conditions that hold (once a second). */
function checkQuests(
  sim: Simulation,
  quests: readonly QuestDef[],
  player: PlayerState,
  out: SimEvent[],
): void {
  const biome = biomeAt(sim, Math.floor(player.body.x), Math.floor(player.body.z));
  if (biome) player.biomes[biome.key] = true;
  for (const quest of quests) {
    let state = player.quests[quest.key];
    let fresh = false;
    if (!state) {
      if (!unlockedFor(player, quest)) continue;
      state = { progress: 0, done: false, claimed: false };
      player.quests[quest.key] = state;
      fresh = true;
      out.push({ type: 'questUnlocked', playerId: player.playerId, quest: quest.key });
    }
    if (!state.done && quest.condition && conditionHolds(sim, player, quest.condition))
      complete(player, state, quest, fresh, out);
  }
}

/**
 * Tick step 16: every living, active player's counters, and once a second their quests and the
 * tasks they hold.
 */
export function stepQuests(sim: Simulation, out: SimEvent[], first: number): void {
  const quests = sim.registry.pack.quests ?? [];
  // The deeds counted are those before this step: its own events are no deeds.
  const last = out.length;
  for (const player of sim.players.values()) {
    if (player.survival.dead || !sim.isActive(player)) continue;
    countDeeds(sim, player, out, first, last);
    if (sim.tick % TICKS_PER_SECOND !== 0) continue;
    checkQuests(sim, quests, player, out);
    fillTasks(sim, player);
  }
}

/** `quest.claim` (the rewards of a quest done, once) and `quest.pin` (null: none pinned). */
export function applyQuestCommand(
  sim: Simulation,
  player: PlayerState,
  command: QuestCommand,
  out: SimEvent[],
): void {
  const key = command.quest;
  const state = typeof key === 'string' ? player.quests[key] : undefined;
  if (command.type === 'quest.pin') {
    if (key !== null && (!state || state.claimed)) {
      reject(out, player.playerId, command.type, 'invalid');
      return;
    }
    player.pinned = key;
    return;
  }
  const quest = sim.registry.pack.quests?.find((q) => q.key === key);
  if (!quest || !state?.done || state.claimed) {
    reject(out, player.playerId, command.type, 'invalid');
    return;
  }
  state.claimed = true;
  if (player.pinned === quest.key) player.pinned = null;
  for (const reward of quest.rewards ?? [])
    giveItems(sim, player, freshStack(sim.registry, reward.item, reward.count), out);
  out.push({ type: 'questClaimed', playerId: player.playerId, quest: quest.key });
  gainXp(sim, player, quest.xp ?? 0, out);
}
