import type { BalanceDef, ProgressionBalance } from '../content/schema.ts';
import { fnv1aString, hash32 } from '../core/hash.ts';
import { reject } from './commandRules.ts';
import type { ProgressCommand } from './commands.ts';
import type { SimEvent } from './events.ts';
import { MAX_INVENTORY_SLOTS } from './inventory.ts';
import type { PlayerState } from './player.ts';
import type { Simulation } from './Simulation.ts';
import { dayOf } from './time.ts';

/*
 * Experience, levels, skills and general tasks (plan v3 « M22 »). XP comes only from claimed quests
 * and tasks; each level past the first gives a skill point; a skill holds at most `maxSkill`
 * points, each worth its number of the balance (`ProgressionBalance.skills`), read where the rule
 * lives: health (`SurvivalState.healthMax`), stamina (`staminaMax`), inventory slots (added when
 * the point is spent), hunger and thirst rates (`metabolism`), the comfort range (`resistance`),
 * melee damage and mining speed (`strength`). Tasks: each player holds `tasks` of the pack's,
 * drawn from the world's seed; a claimed one pays its XP and is drawn again, and one may be
 * redrawn once a game day.
 */

export const SKILLS = [
  'vitality',
  'endurance',
  'carrying',
  'metabolism',
  'resistance',
  'strength',
] as const;
export type Skill = (typeof SKILLS)[number];
export type Skills = Record<Skill, number>;

/** A task a player holds: its key and the deeds counted since it was drawn. */
export interface TaskState {
  key: string;
  progress: number;
}

export function createSkills(): Skills {
  return { vitality: 0, endurance: 0, carrying: 0, metabolism: 0, resistance: 0, strength: 0 };
}

/** XP from `level` to the next one. */
export function xpToNext(level: number, p: ProgressionBalance): number {
  return p.xpBase + p.xpStep * (level - 1);
}

/** The level reached with `xp` (1 with none). */
export function levelOf(xp: number, p: ProgressionBalance): number {
  let level = 1;
  for (let left = xp; left >= xpToNext(level, p); level++) left -= xpToNext(level, p);
  return level;
}

/** XP gained since the current level was reached. */
export function xpIntoLevel(xp: number, p: ProgressionBalance): number {
  let left = xp;
  for (let level = 1; left >= xpToNext(level, p); level++) left -= xpToNext(level, p);
  return left;
}

/** Skill points not spent yet. */
export function pointsLeft(player: Readonly<PlayerState>, p: ProgressionBalance): number {
  let spent = 0;
  for (const skill of SKILLS) spent += player.skills[skill];
  return levelOf(player.xp, p) - 1 - spent;
}

/** Largest stamina: the base plus endurance. */
export function staminaMax(player: Readonly<PlayerState>, b: BalanceDef, base: number): number {
  return base + player.skills.endurance * b.progression.skills.endurance;
}

/** Largest health: the balance's plus vitality. */
export function healthMax(skills: Readonly<Skills>, b: BalanceDef): number {
  return b.health.max + skills.vitality * b.progression.skills.vitality;
}

/** Factor on the hunger and thirst rates (metabolism). */
export function metabolismFactor(player: Readonly<PlayerState>, b: BalanceDef): number {
  return 1 - player.skills.metabolism * b.progression.skills.metabolism;
}

/** °C added to each side of the comfort range (resistance). */
export function comfortBonus(player: Readonly<PlayerState>, b: BalanceDef): number {
  return player.skills.resistance * b.progression.skills.resistance;
}

/** Factor on melee damage and mining speed (strength). */
export function strengthFactor(player: Readonly<PlayerState>, b: BalanceDef): number {
  return 1 + player.skills.strength * b.progression.skills.strength;
}

/** Adds XP, telling of each level reached. */
export function gainXp(sim: Simulation, player: PlayerState, xp: number, out: SimEvent[]): void {
  if (xp <= 0) return;
  const p = sim.registry.pack.balance.progression;
  const before = levelOf(player.xp, p);
  player.xp += xp;
  const after = levelOf(player.xp, p);
  out.push({ type: 'xpGained', playerId: player.playerId, xp, level: after });
  if (after > before) out.push({ type: 'levelUp', playerId: player.playerId, level: after });
}

/** Draws a task the player does not hold, from the world's seed and the player's draw count. */
function drawTask(sim: Simulation, player: PlayerState): TaskState | null {
  const tasks = sim.registry.pack.tasks ?? [];
  if (tasks.length <= player.tasks.length) return null;
  let index = hash32(fnv1aString(sim.seed), player.playerId, player.taskDraws++) % tasks.length;
  while (player.tasks.some((held) => held.key === tasks[index]!.key))
    index = (index + 1) % tasks.length;
  return { key: tasks[index]!.key, progress: 0 };
}

/** Fills a player's tasks up to the balance's count (on the quests' once-a-second check). */
export function fillTasks(sim: Simulation, player: PlayerState): void {
  const held = sim.registry.pack.balance.progression.tasks;
  while (player.tasks.length < held) {
    const task = drawTask(sim, player);
    if (!task) return;
    player.tasks.push(task);
  }
}

/** `skill.spend`, `task.claim` and `task.reroll`. */
export function applyProgressCommand(
  sim: Simulation,
  player: PlayerState,
  command: ProgressCommand,
  out: SimEvent[],
): void {
  const b = sim.registry.pack.balance;
  const p = b.progression;
  if (command.type === 'skill.spend') {
    const skill = command.skill;
    if (
      !SKILLS.includes(skill) ||
      pointsLeft(player, p) < 1 ||
      player.skills[skill] >= p.maxSkill
    ) {
      reject(out, player.playerId, command.type, 'invalid');
      return;
    }
    if (skill === 'carrying' && player.inventory.length + p.skills.carrying > MAX_INVENTORY_SLOTS) {
      reject(out, player.playerId, command.type, 'full');
      return;
    }
    player.skills[skill]++;
    if (skill === 'carrying')
      for (let i = 0; i < p.skills.carrying; i++) player.inventory.push(null);
    if (skill === 'vitality') player.survival.healthMax = healthMax(player.skills, b);
    out.push({ type: 'skillSpent', playerId: player.playerId, skill });
    out.push({ type: 'inventoryChanged', playerId: player.playerId });
    return;
  }
  const index = command.index;
  const held = Number.isInteger(index) ? player.tasks[index] : undefined;
  const def = held ? sim.registry.pack.tasks?.find((task) => task.key === held.key) : undefined;
  if (!held || !def) {
    reject(out, player.playerId, command.type, 'invalid');
    return;
  }
  const done = held.progress >= def.counter.count;
  if (command.type === 'task.claim') {
    if (!done) {
      reject(out, player.playerId, command.type, 'not done');
      return;
    }
    gainXp(sim, player, def.xp, out);
  } else {
    const day = dayOf(sim.time.ticks);
    if (done || player.rerollDay === day) {
      reject(out, player.playerId, command.type, done ? 'done' : 'tomorrow');
      return;
    }
    player.rerollDay = day;
  }
  // Drawn while the old one is still held, so it never comes straight back.
  const next = drawTask(sim, player);
  if (next) player.tasks[index] = next;
  else player.tasks.splice(index, 1);
  out.push({ type: 'taskChanged', playerId: player.playerId });
}
