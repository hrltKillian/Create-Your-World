import type { Registry } from '../../content/registry.ts';
import { Rng } from '../../core/rng.ts';
import type { VoxelWorld } from '../../world/VoxelWorld.ts';
import type { Command } from '../commands.ts';
import type { PlayerState } from '../player.ts';
import { wanderMineBuildBot } from './wanderMineBuild.ts';

export type BotKind = 'wander' | 'wanderMineBuild';
export const BOT_KINDS: readonly BotKind[] = ['wander', 'wanderMineBuild'];

/**
 * Scripted player for tests, headless runs and the browser driver: deterministic for a given seed
 * (its decisions come from its own seeded random stream and the simulation's state).
 */
export interface Bot {
  /**
   * This tick's commands into `out`, from the player's current state: the respawn while it is dead
   * (createBot), at most one inventory chore (a Shift+click in the Bag opened and closed for it,
   * or a throw), then the input (always last).
   */
  next(player: Readonly<PlayerState>, tick: number, out: Command[]): void;
}

/** What a bot reads besides its player: the pack (item kinds) and the world (water, bushes). */
export interface BotWorld {
  readonly registry: Registry;
  readonly world: VoxelWorld;
}

const RESPAWN: Command = { type: 'player.respawn' };

/**
 * A bot of a kind. While its player is dead it first asks to respawn (the death screen's
 * Respawn), so long runs keep death and respawn in their hashes instead of a body lying still.
 */
export function createBot(kind: BotKind, seed: string, world: BotWorld): Bot {
  const bot = kind === 'wander' ? wanderBot(seed) : wanderMineBuildBot(seed, world);
  return {
    next(player, tick, out) {
      if (player.survival.dead) out.push(RESPAWN);
      bot.next(player, tick, out);
    },
  };
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
    next(player, tick, out) {
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
      out.push({
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
      });
    },
  };
}
