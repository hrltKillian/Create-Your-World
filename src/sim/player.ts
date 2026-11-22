import { type InputCommand, NEUTRAL_INPUT } from './commands.ts';
import { type Body, createBody } from './physics.ts';

/** Stamina rules (docs/conception.md « Survie »). */
export const STAMINA = {
  max: 100,
  sprintPerSecond: 10,
  jump: 5,
  regenPerSecond: 25,
  /** Ticks without spending before stamina regenerates (0.8 s). */
  regenDelayTicks: 24,
  /** After running dry, sprinting is locked until stamina is back to this value. */
  recoverAt: 30,
} as const;

/** A player entity (serialisable plain data). */
export interface PlayerState {
  readonly kind: 'player';
  readonly id: number;
  body: Body;
  /** Feet position at the previous tick (render interpolation). */
  prevX: number;
  prevY: number;
  prevZ: number;
  yaw: number;
  pitch: number;
  stamina: number;
  exhausted: boolean;
  /** Ticks since stamina was last spent. */
  restTicks: number;
  input: InputCommand;
  /** Render distance requested by the player's client (columns). */
  viewRadius: number;
}

export function createPlayer(
  id: number,
  x: number,
  y: number,
  z: number,
  viewRadius: number,
): PlayerState {
  return {
    kind: 'player',
    id,
    body: createBody(x, y, z),
    prevX: x,
    prevY: y,
    prevZ: z,
    yaw: 0,
    pitch: 0,
    stamina: STAMINA.max,
    exhausted: false,
    restTicks: STAMINA.regenDelayTicks,
    input: NEUTRAL_INPUT,
    viewRadius,
  };
}

/** Spends stamina; running dry locks sprinting until `recoverAt`. */
export function spendStamina(player: PlayerState, amount: number): void {
  if (amount <= 0) return;
  player.stamina = Math.max(0, player.stamina - amount);
  player.restTicks = 0;
  if (player.stamina === 0) player.exhausted = true;
}

/** Regenerates stamina after a rest delay. */
export function restStamina(player: PlayerState, dt: number): void {
  player.restTicks++;
  if (player.restTicks >= STAMINA.regenDelayTicks) {
    player.stamina = Math.min(STAMINA.max, player.stamina + STAMINA.regenPerSecond * dt);
  }
  if (player.exhausted && player.stamina >= STAMINA.recoverAt) player.exhausted = false;
}
