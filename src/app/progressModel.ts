import type { BalanceDef } from '../content/schema.ts';
import { MAX_INVENTORY_SLOTS } from '../sim/inventory.ts';
import type { PlayerState } from '../sim/player.ts';
import { levelOf, pointsLeft, xpIntoLevel, xpToNext } from '../sim/progression.ts';
import { dayOf } from '../sim/time.ts';
import type { Progress } from '../ui/status.ts';

/*
 * What the Status and Quests pages show of a player's progress (plan v3 « M22 »), from the
 * simulation's own rules (sim/progression.ts).
 */

export function progressOf(player: Readonly<PlayerState>, b: BalanceDef): Progress {
  const p = b.progression;
  const level = levelOf(player.xp, p);
  return {
    level,
    xpIntoLevel: xpIntoLevel(player.xp, p),
    xpToNext: xpToNext(level, p),
    pointsLeft: pointsLeft(player, p),
    skills: player.skills,
    bagRoom: player.inventory.length + p.skills.carrying <= MAX_INVENTORY_SLOTS,
  };
}

/** Whether a task may be redrawn now: once a game day. */
export function canReroll(player: Readonly<PlayerState>, ticks: number): boolean {
  return player.rerollDay !== dayOf(ticks);
}
