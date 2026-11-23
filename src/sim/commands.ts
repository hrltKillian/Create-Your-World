import { INVENTORY_SLOTS } from './inventory.ts';
import type { DeathCause, Gauge } from './survival.ts';

/** Commands are the only way to change simulation state (they could travel over a network). */
export type Command =
  | {
      readonly type: 'client.view';
      /** Block position of the client's camera (used when the player has no body, e.g. free camera). */
      readonly x: number;
      readonly z: number;
      /** Render distance in columns. */
      readonly radius: number;
      /** Stream around (x, z) instead of the player's body (free camera). */
      readonly detached?: boolean;
    }
  | InputCommand
  | InventoryCommand
  | BlockEntityCommand
  | EquipCommand
  | CraftCommand
  /** Comes back after a death (the death screen's Respawn button); refused while alive. */
  | { readonly type: 'player.respawn' }
  | DebugCommand;

/**
 * The block cell and face (0–5, registry face order: `faceOfNormal` of the hit) under the client's
 * crosshair. Left out when the client's ray hits nothing or starts inside a block.
 */
export interface ClientTarget {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly face: number;
}

/** Sampled once per tick by the client: movement, view angles and buttons. */
export interface InputCommand {
  readonly type: 'input';
  /** −1…1. */
  readonly forward: number;
  readonly strafe: number;
  readonly jump: boolean;
  readonly sprint: boolean;
  readonly crouch: boolean;
  readonly yaw: number;
  readonly pitch: number;
  readonly primary: boolean;
  readonly secondary: boolean;
  /** Selected hotbar slot. */
  readonly slot: number;
  /** What the client aims at, from its interpolated eye (the simulation checks it). */
  readonly target?: ClientTarget;
}

/** Atomic inventory edits sent by the UI (slots 0–7 are the hotbar, 8–31 the bag). */
export type InventoryCommand =
  /** Moves `count` items (default: the whole stack): merges, or swaps two whole stacks. */
  | {
      readonly type: 'inv.move';
      readonly from: number;
      readonly to: number;
      readonly count?: number;
    }
  /** Sends a stack from the hotbar to the bag, or from the bag to the hotbar. */
  | { readonly type: 'inv.quickMove'; readonly slot: number }
  /** Throws one item of a slot (or the whole stack) in front of the player. */
  | { readonly type: 'inv.drop'; readonly slot: number; readonly all: boolean };

/**
 * The Container and Station screens (docs « Écrans »). A player has at most one block entity open
 * (a chest or a station, within 5 blocks, one player at a time). Moves number the slots like
 * inventory commands (0–31), then the open block entity's slots from 32 (a station: its inputs,
 * its fuel slot, its outputs: content/crafting.ts `fuelSlotOf`, `outputSlotOf`). Without `to`, the
 * whole stack goes to the other side (Shift+click; « Take all » and « Store all » send one per slot).
 */
export type BlockEntityCommand =
  | { readonly type: 'container.open'; readonly x: number; readonly y: number; readonly z: number }
  | { readonly type: 'container.close' }
  | SlotMove<'container.move'>
  | SlotMove<'station.move'>;

/** A move between the inventory (slots 0–31) and other slots numbered from `OPEN_SLOTS_BASE`. */
export interface SlotMove<T extends 'container.move' | 'station.move' | 'equip.move'> {
  readonly type: T;
  readonly from: number;
  readonly to?: number;
  readonly count?: number;
}

/**
 * The Bag's equipment boxes (sim/equipment.ts): the worn items are slots 32–36, in `WEAR_SLOTS`
 * order. An item only goes into the box of its `wear.slot`. Without `to` (Shift+click) a wearable
 * is put on (swapping what was worn), a worn item taken off, anything else moved between the
 * hotbar and the bag.
 */
export type EquipCommand = SlotMove<'equip.move'>;

/** First slot number of the open block entity, or of the worn items, in moves (32). */
export const OPEN_SLOTS_BASE = INVENTORY_SLOTS;

/** The Logbook (docs « Craft : le Logbook »): a queue of 5 entries per player. */
export type CraftCommand =
  /** Queues `count` crafts of a recipe as one entry, reserving all their ingredients at once. */
  | { readonly type: 'craft.enqueue'; readonly recipe: string; readonly count: number }
  /** Cancels a queue entry; its ingredients come back (at the player's feet if the bag is full). */
  | { readonly type: 'craft.cancel'; readonly index: number };

/** Developer commands, refused unless the world rules allow debugging. */
export type DebugCommand =
  /** Moves the player, at rest; `'surface'` lands on the top of the ground (edits included). */
  | {
      readonly type: 'debug.teleport';
      readonly x: number;
      readonly y: number | 'surface';
      readonly z: number;
    }
  /** Sets a gauge, clamped to its range (stamina, or one of the survival gauges). */
  | { readonly type: 'debug.setStat'; readonly stat: DebugStat; readonly value: number }
  /** Takes all the player's health for a cause; the death follows at tick step 14. */
  | { readonly type: 'debug.kill'; readonly cause: DeathCause }
  /** Makes the player immune to damage, or mortal again (the gauges still move). */
  | { readonly type: 'debug.god'; readonly on: boolean }
  /** Adds items to the player's inventory (what does not fit drops at the player's feet). */
  | { readonly type: 'debug.give'; readonly item: string; readonly count: number }
  /** Moves the clock to an hour (0 ≤ hours < 24) of the current day. */
  | { readonly type: 'debug.setTime'; readonly hours: number }
  /** Stops or restarts the clock (the world keeps ticking). */
  | { readonly type: 'debug.freezeTime'; readonly frozen: boolean }
  /**
   * Opens the chest or station of a cell as secondary on it does (within 5 blocks, one player at a
   * time), whether or not the player aims at it: the hook's `ui.open(x, y, z)`.
   */
  | { readonly type: 'debug.open'; readonly x: number; readonly y: number; readonly z: number }
  | {
      /** Fills a box (inclusive corners) of loaded blocks with a block state given by its text key. */
      readonly type: 'debug.fill';
      readonly x0: number;
      readonly y0: number;
      readonly z0: number;
      readonly x1: number;
      readonly y1: number;
      readonly z1: number;
      readonly state: string;
    };

/** Gauges a debug.setStat may set: stamina, or one of the survival gauges. */
export type DebugStat = 'stamina' | Gauge;

export interface StampedCommand {
  readonly playerId: number;
  readonly seq: number;
  readonly command: Command;
}

export const NEUTRAL_INPUT: InputCommand = {
  type: 'input',
  forward: 0,
  strafe: 0,
  jump: false,
  sprint: false,
  crouch: false,
  yaw: 0,
  pitch: 0,
  primary: false,
  secondary: false,
  slot: 0,
};
