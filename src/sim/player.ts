import type { Registry } from '../content/registry.ts';
import { type BalanceDef, WEAR_SLOTS } from '../content/schema.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import { type InputCommand, NEUTRAL_INPUT } from './commands.ts';
import type { CraftEntry } from './craftQueue.ts';
import type { SimEvent } from './events.ts';
import { createInventory, type Inventory } from './inventory.ts';
import { type Body, createBody, type MoveInput, type StepResult, stepBody } from './physics.ts';
import {
  createSurvival,
  fallDamage,
  hurt,
  type SurvivalState,
  staminaCap,
  staminaRegen,
} from './survival.ts';

/** Stamina rules (docs/conception.md « Survie »). */
export const STAMINA = {
  max: 100,
  sprintPerSecond: 10,
  jump: 5,
  minePerSecond: 2.5,
  regenPerSecond: 25,
  /** Ticks without spending before stamina regenerates (0.8 s). */
  regenDelayTicks: 24,
  /** After running dry, sprinting is locked until stamina is back to this value. */
  recoverAt: 30,
} as const;

/** What a player does to the world: mining and the held use button (driven by interaction.ts). */
export interface InteractionState {
  /** Block being mined, valid while `mineStage` ≥ 0. */
  mineX: number;
  mineY: number;
  mineZ: number;
  /** 0…1; the block breaks at 1. */
  mineProgress: number;
  /** Crack stage last reported (0–7), −1 when not mining. */
  mineStage: number;
  /** Ticks before a held secondary button acts again. */
  useCooldown: number;
  /** Secondary was down last tick (gates toggle on the press only). */
  useHeld: boolean;
  /** The action the held secondary started (consume.ts): NO_USE, −1 a sip, else the item id. */
  useItem: number;
  /** Ticks it has been held for (an item eaten or drunk, a sip). */
  useTicks: number;
}

/** `InteractionState.useItem` when secondary holds no action. */
export const NO_USE = -2;

export function createInteraction(): InteractionState {
  return {
    mineX: 0,
    mineY: 0,
    mineZ: 0,
    mineProgress: 0,
    mineStage: -1,
    useCooldown: 0,
    useHeld: false,
    useItem: NO_USE,
    useTicks: 0,
  };
}

/** A player's entity record, serialisable plain data (creatures join in M10). */
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
  /** Sprinted this tick (hunger and thirst drain faster); set by stepPlayer, not saved. */
  sprinting: boolean;
  input: InputCommand;
  /** Render distance requested by the player's client (columns). */
  viewRadius: number;
  /** 32 slots: the hotbar (0–7, the selected one is `input.slot`) then the bag. */
  inventory: Inventory;
  interaction: InteractionState;
  /** The Logbook's queue (at most 5 entries, the first one in progress). */
  craft: CraftEntry[];
  /**
   * Item keys the player has had in the inventory, and their tags (recipe reveal:
   * `Crafting.revealed`). Plain data for hashes and saves.
   */
  seen: Record<string, true>;
  /** Cell of the block entity whose screen the player has open (not saved). */
  opened: BlockCell | null;
  /** Gauges, timed effects and the last environment sample (survival.ts). */
  survival: SurvivalState;
  /** Worn items, one slot per `WEAR_SLOTS` entry (head to feet). */
  equipment: Inventory;
  /** Where the player comes back after a death: the last bedroll slept on, else the spawn. */
  respawn: BlockCell | null;
  /** Abandoned Packs left by the player's deaths (compass markers), oldest first. */
  graves: BlockCell[];
  /** Keys of the objectives done, in the order they were done. */
  objectives: string[];
  /** Has drunk at least once: a sip, or a consumable that quenches thirst (objectives). */
  drank: boolean;
  /**
   * The bedroll the player lies on while the others are still awake (sleep.ts; not saved): the
   * night passes once every living player sleeps.
   */
  sleeping: Sleeper | null;
}

export interface BlockCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A player lying on the bedroll at a cell, with the health they had at the last check. */
export interface Sleeper extends BlockCell {
  health: number;
}

export function createPlayer(
  playerId: number,
  x: number,
  y: number,
  z: number,
  viewRadius: number,
  balance: BalanceDef,
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
    sprinting: false,
    input: NEUTRAL_INPUT,
    viewRadius,
    inventory: createInventory(),
    interaction: createInteraction(),
    craft: [],
    seen: {},
    opened: null,
    survival: createSurvival(balance),
    equipment: new Array<null>(WEAR_SLOTS.length).fill(null),
    respawn: null,
    graves: [],
    objectives: [],
    drank: false,
    sleeping: null,
  };
}

/** Spends stamina (it costs hunger: survival.ts); running dry locks sprinting until `recoverAt`. */
export function spendStamina(player: PlayerState, amount: number): void {
  if (amount <= 0) return;
  const spent = Math.min(player.stamina, amount);
  player.stamina -= spent;
  player.survival.staminaSpent += spent;
  player.restTicks = 0;
  if (player.stamina === 0) player.exhausted = true;
}

/** Regenerates stamina after a rest delay (slower while parched, capped while starving). */
export function restStamina(player: PlayerState, dt: number, balance: BalanceDef): void {
  player.restTicks++;
  if (player.restTicks >= STAMINA.regenDelayTicks) {
    const rate = STAMINA.regenPerSecond * staminaRegen(player.survival, balance);
    player.stamina = Math.min(STAMINA.max, player.stamina + rate * dt);
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
 * cannot fall into the void) and alive. A landing takes its fall damage. Returns whether the body
 * was stepped.
 */
export function stepPlayer(
  player: PlayerState,
  active: boolean,
  world: VoxelWorld,
  registry: Registry,
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
  player.sprinting = false;
  // A dead player lies still until the respawn (death.ts).
  if (!active || player.survival.health <= 0) return false;
  const balance = registry.pack.balance;
  const canSprint = !player.exhausted && player.stamina > 0;
  move.forward = input.forward;
  move.strafe = input.strafe;
  move.jump = input.jump;
  move.jumpAllowed = player.stamina >= STAMINA.jump;
  move.sprint = input.sprint && canSprint;
  move.crouch = input.crouch;
  move.yaw = input.yaw;
  const result = stepBody(body, move, world, registry.tables, dt, stepResult);
  if (result.jumped) spendStamina(player, STAMINA.jump);
  const moving = Math.abs(body.vx) + Math.abs(body.vz) > 0.1;
  player.sprinting = result.sprinting && moving;
  if (player.sprinting) spendStamina(player, STAMINA.sprintPerSecond * dt);
  else restStamina(player, dt, balance);
  player.stamina = Math.min(player.stamina, staminaCap(player.survival, balance, STAMINA.max));
  if (result.landedFrom > 0) {
    out.push({ type: 'playerLanded', playerId: player.playerId, fall: result.landedFrom });
    hurt(player.survival, fallDamage(result.landedFrom, balance), 'fall');
  }
  return true;
}
