import type { RawTables } from '../content/registry.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import { type InputCommand, NEUTRAL_INPUT } from './commands.ts';
import type { SimEvent } from './events.ts';
import { type Body, createBody, type MoveInput, type StepResult, stepBody } from './physics.ts';

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

/** A player's entity record, serialisable plain data (creatures and item drops join later). */
export interface PlayerState {
  readonly kind: 'player';
  /** Entity id: unique in the world and never reused. */
  readonly id: number;
  /** Connection (client) id that sends this player's commands. */
  readonly playerId: number;
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
  playerId: number,
  x: number,
  y: number,
  z: number,
  viewRadius: number,
  entityId = playerId,
): PlayerState {
  return {
    kind: 'player',
    id: entityId,
    playerId,
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

/** Scratch input and result of stepBody (no allocation per tick). */
const move: MoveInput = {
  forward: 0,
  strafe: 0,
  jump: false,
  jumpAllowed: false,
  sprint: false,
  crouch: false,
  yaw: 0,
};
const stepResult: StepResult = { landedFrom: 0, jumped: false, sprinting: false };

/**
 * One tick of player control. The previous position (render interpolation) and the view angles
 * always update; physics and stamina only run when `active` (its column is LIT: a frozen player
 * cannot fall into the void). Returns whether the body was stepped.
 */
export function stepPlayer(
  player: PlayerState,
  active: boolean,
  world: VoxelWorld,
  tables: RawTables,
  dt: number,
  out: SimEvent[],
): boolean {
  const body = player.body;
  player.prevX = body.x;
  player.prevY = body.y;
  player.prevZ = body.z;
  const input = player.input;
  player.yaw = input.yaw;
  player.pitch = input.pitch;
  if (!active) return false;
  const canSprint = !player.exhausted && player.stamina > 0;
  move.forward = input.forward;
  move.strafe = input.strafe;
  move.jump = input.jump;
  move.jumpAllowed = player.stamina >= STAMINA.jump;
  move.sprint = input.sprint && canSprint;
  move.crouch = input.crouch;
  move.yaw = input.yaw;
  const result = stepBody(body, move, world, tables, dt, stepResult);
  if (result.jumped) spendStamina(player, STAMINA.jump);
  const moving = Math.abs(body.vx) + Math.abs(body.vz) > 0.1;
  if (result.sprinting && moving) spendStamina(player, STAMINA.sprintPerSecond * dt);
  else restStamina(player, dt);
  if (result.landedFrom > 0)
    out.push({ type: 'playerLanded', playerId: player.playerId, fall: result.landedFrom });
  return true;
}
