import type { Registry } from '../content/registry.ts';
import { type BalanceDef, type ItemDef, WEAR_SLOTS } from '../content/schema.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import { type InputCommand, NEUTRAL_INPUT } from './commands.ts';
import { consuming, NO_USE } from './consume.ts';
import type { CraftEntry } from './craftQueue.ts';
import type { SimEvent } from './events.ts';
import type { Waypoint } from './exploration.ts';
import { createInventory, type Inventory, type ItemStack } from './inventory.ts';
import { type Body, createBody, type MoveInput, type StepResult, stepBody } from './physics.ts';
import { createSkills, type Skills, staminaMax, type TaskState } from './progression.ts';
import type { QuestState } from './quests.ts';
import { createSurvival, exhaust, fallDamage, hurt, type SurvivalState } from './survival.ts';

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
  /**
   * The held secondary's action while it runs (consume.ts): NO_USE, −1 a sip, else the item id;
   * back to NO_USE as soon as it stops (released, another hand or target).
   */
  useItem: number;
  /** Ticks it has been held for (an item eaten or drunk, a sip). */
  useTicks: number;
}

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

/** A player's entity record, serialisable plain data. */
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
  /** Ticks the player stays loud after a blow given or taken (combat.ts). */
  fightTicks: number;
  /** Ticks before a creature's blow may hurt the player again (combat.ts). */
  invulnerable: number;
  /** Ticks before the player may attack again (melee.ts). */
  attackCooldown: number;
  /** Primary was held last tick (a press is its first tick: melee.ts; not saved). */
  primaryHeld: boolean;
  /** The current hold of primary began with a swing: no mining until it is released (not saved). */
  swinging: boolean;
  input: InputCommand;
  /** Render distance requested by the player's client (columns). */
  viewRadius: number;
  /**
   * The hotbar (0–7, the selected one is `input.slot`) then the bag: its length is the player's
   * inventory size (inventory.ts `inventorySize`: 32 at first, 64 at most).
   */
  inventory: Inventory;
  /**
   * The stack the player holds on the cursor of the open screen (sim/slotClicks.ts): back in the
   * inventory when the screen closes, in the Abandoned Pack at a death. Saved.
   */
  cursor: ItemStack | null;
  /** The screen the player has open (not saved): the Bag, or a chest's or station's. */
  screen: PlayerScreen | null;
  interaction: InteractionState;
  /** The Logbook's queue (at most 5 entries, the first one in progress). */
  craft: CraftEntry[];
  /**
   * Item keys the player has had in the inventory, and their tags (recipe reveal:
   * `Crafting.revealed`). Plain data for hashes and saves.
   */
  seen: Record<string, true>;
  /** Gauges, timed effects and the last environment sample (survival.ts). */
  survival: SurvivalState;
  /** Worn items, one slot per `WEAR_SLOTS` entry (head to feet). */
  equipment: Inventory;
  /** Where the player comes back after a death: the last bedroll slept on, else the spawn. */
  respawn: BlockCell | null;
  /** Abandoned Packs left by the player's deaths (compass markers), oldest first. */
  graves: BlockCell[];
  /** The quests unlocked, by key, in the order they unlocked (sim/quests.ts). */
  quests: Record<string, QuestState>;
  /** The quest pinned to the compass, if any. */
  pinned: string | null;
  /** Biome keys the player has stood in (quests). */
  biomes: Record<string, true>;
  /** Experience, skill points spent, tasks held (sim/progression.ts). */
  xp: number;
  skills: Skills;
  tasks: TaskState[];
  /** Tasks drawn so far (the next draw's number) and the day of the last redraw (−1: none). */
  taskDraws: number;
  rerollDay: number;
  /** Columns explored (`cx,cz` keys) and the places marked (sim/exploration.ts). */
  explored: Record<string, true>;
  waypoints: Waypoint[];
  /** Has drunk at least once: a sip, or a consumable that quenches thirst (quests). */
  drank: boolean;
  /** The bestiary: creature key → MET or STUDIED (sim/bestiary.ts). */
  bestiary: Record<string, number>;
  /** The creature a worn scanner looks at (−1: none) and the ticks it has (not saved). */
  scanId: number;
  scanTicks: number;
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

/** The Bag, or the screen of the block entity (a chest, a station) at a cell. */
export type PlayerScreen = { readonly kind: 'bag' } | BlockScreen;

export interface BlockScreen extends BlockCell {
  readonly kind: 'block';
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
    fightTicks: 0,
    invulnerable: 0,
    attackCooldown: 0,
    primaryHeld: false,
    swinging: false,
    input: NEUTRAL_INPUT,
    viewRadius,
    inventory: createInventory(),
    cursor: null,
    screen: null,
    interaction: createInteraction(),
    craft: [],
    seen: {},
    survival: createSurvival(balance),
    equipment: new Array<null>(WEAR_SLOTS.length).fill(null),
    respawn: null,
    graves: [],
    quests: {},
    pinned: null,
    biomes: {},
    xp: 0,
    skills: createSkills(),
    tasks: [],
    taskDraws: 0,
    rerollDay: -1,
    explored: {},
    waypoints: [],
    drank: false,
    bestiary: {},
    scanId: -1,
    scanTicks: 0,
    sleeping: null,
  };
}

/** The item id in the player's selected hotbar slot (−1: the bare hand). */
export function heldItemId(registry: Registry, player: Readonly<PlayerState>): number {
  const stack = player.inventory[player.input.slot];
  return stack ? registry.itemId(stack.item) : -1;
}

/** The item in the player's hand (undefined: the bare hand, or an item the pack lacks). */
export function heldItem(registry: Registry, player: Readonly<PlayerState>): ItemDef | undefined {
  const id = heldItemId(registry, player);
  return id < 0 ? undefined : registry.items[id];
}

/** Spends stamina; running dry locks sprinting until `recoverAt`. */
export function spendStamina(player: PlayerState, amount: number): void {
  if (amount <= 0) return;
  const spent = Math.min(player.stamina, amount);
  player.stamina -= spent;
  player.restTicks = 0;
  if (player.stamina === 0) player.exhausted = true;
}

/** Regenerates stamina after a rest delay, up to the largest (endurance: sim/progression.ts). */
export function restStamina(player: PlayerState, dt: number, balance: BalanceDef): void {
  player.restTicks++;
  if (player.restTicks >= STAMINA.regenDelayTicks) {
    const top = staminaMax(player, balance, STAMINA.max);
    player.stamina = Math.min(top, player.stamina + STAMINA.regenPerSecond * dt);
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
  speedFactor: 1,
  yaw: 0,
  pitch: 0,
};
const stepResult: StepResult = { landedFrom: 0, jumped: false, sprinting: false };

/**
 * One tick of player control. The previous position (render interpolation) and the view angles
 * always update; physics and stamina only run when `active` (its column is LIT: a frozen player
 * cannot fall into the void) and alive. Eating or drinking slows the player (`consuming`). A
 * landing takes its fall damage. Returns whether the body was stepped.
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
  // Sprinting needs stamina and, as in the reference game, more than a little hunger.
  const canSprint =
    !player.exhausted && player.stamina > 0 && player.survival.hunger > balance.hunger.sprintFrom;
  const slowed = consuming(player);
  move.forward = input.forward;
  move.strafe = input.strafe;
  move.jump = input.jump;
  move.jumpAllowed = player.stamina >= STAMINA.jump;
  move.sprint = input.sprint && canSprint && !slowed;
  move.crouch = input.crouch;
  move.speedFactor = slowed ? balance.consume.moveFactor : 1;
  move.yaw = input.yaw;
  move.pitch = input.pitch;
  const result = stepBody(body, move, world, registry.tables, dt, stepResult);
  const s = player.survival;
  const effort = balance.hunger.exhaustion;
  if (result.jumped) {
    spendStamina(player, STAMINA.jump);
    exhaust(s, result.sprinting ? effort.sprintJump : effort.jump);
    out.push({ type: 'playerJumped', playerId: player.playerId });
  }
  const moving = Math.abs(body.vx) + Math.abs(body.vz) > 0.1;
  player.sprinting = result.sprinting && moving;
  if (player.sprinting) spendStamina(player, STAMINA.sprintPerSecond * dt);
  else restStamina(player, dt, balance);
  // The reference game's exhaustion per block sprinted or swum (plan v3 « M30 »).
  const dx = body.x - player.prevX;
  const dz = body.z - player.prevZ;
  const blocks = Math.sqrt(dx * dx + dz * dz);
  if (player.sprinting) exhaust(s, effort.sprintPerBlock * blocks);
  else if (body.inWater) exhaust(s, effort.swimPerBlock * blocks);
  if (result.landedFrom > 0) {
    out.push({ type: 'playerLanded', playerId: player.playerId, fall: result.landedFrom });
    const damage = fallDamage(result.landedFrom, balance);
    hurt(s, damage, 'fall');
    if (damage > 0) exhaust(s, effort.hurt);
  }
  return true;
}
