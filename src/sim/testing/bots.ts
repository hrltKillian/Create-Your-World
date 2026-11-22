import { Rng } from '../../core/rng.ts';
import type { InputCommand } from '../commands.ts';
import type { PlayerState } from '../player.ts';

export type BotKind = 'wander';
export const BOT_KINDS: readonly BotKind[] = ['wander'];

/** Scripted player for tests and headless runs: deterministic for a given seed. */
export interface Bot {
  /** Input for the next tick, from the player's current state. */
  next(player: Readonly<PlayerState>, tick: number): InputCommand;
}

export function createBot(kind: BotKind, seed: string): Bot {
  switch (kind) {
    case 'wander':
      return wanderBot(seed);
  }
}

/**
 * Walks in random directions for 1–5 s at a time, sprints now and then (while it has stamina),
 * jumps when blocked or in water, and turns when it stays stuck.
 */
export function wanderBot(seed: string): Bot {
  const rng = Rng.fromSeed(seed, 'bot:wander');
  let yaw = 0;
  let until = 0;
  let sprint = false;
  let lastX = Number.NaN;
  let lastZ = Number.NaN;
  let stuck = 0;
  return {
    next(player, tick) {
      if (tick >= until) {
        yaw = rng.range(-Math.PI, Math.PI);
        until = tick + rng.intRange(30, 150);
        sprint = rng.chance(0.3);
      }
      const b = player.body;
      const moved = Math.abs(b.x - lastX) + Math.abs(b.z - lastZ);
      lastX = b.x;
      lastZ = b.z;
      stuck = moved < 0.02 ? stuck + 1 : 0;
      if (stuck > 45) {
        // Still blocked after jumping: pick another direction next tick.
        until = tick + 1;
        stuck = 0;
      }
      return {
        type: 'input',
        forward: 1,
        strafe: 0,
        jump: stuck > 3 || b.inWater || rng.chance(0.01),
        sprint: sprint && player.stamina > 20,
        crouch: false,
        yaw,
        pitch: 0,
        primary: false,
        secondary: false,
        slot: 0,
      };
    },
  };
}
