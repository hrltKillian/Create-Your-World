import { MAX_INVENTORY_SLOTS } from './inventory.ts';
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
  | ScreenCommand
  | SlotCommand
  | BlockEntityCommand
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

/** Throws one item of an inventory slot (or the whole stack) in front of the player (no screen). */
export interface InventoryCommand {
  readonly type: 'inv.drop';
  readonly slot: number;
  readonly all: boolean;
}

/**
 * The slot screens (docs « Écrans »): the Bag opens on its key; a chest or a station opens on
 * secondary on its block, or `container.open`. A player has one screen open at most (opening one
 * closes the other); closing it puts the cursor stack back in the inventory (sim/screens.ts).
 */
export type ScreenCommand =
  | { readonly type: 'screen.open'; readonly kind: 'bag' }
  | { readonly type: 'screen.close' };

/**
 * Clicks on the open screen's slots (sim/slotClicks.ts, decision 20): the screen's slots are
 * numbered from 0 for the inventory (hotbar 0–7, then the bag, `inventory.length` slots), then
 * from OPEN_SLOTS_BASE (64) for the open block entity's (a station: its inputs, its fuel slot, its
 * outputs: content/crafting.ts `fuelSlotOf`, `outputSlotOf`) or the Bag's worn items (in
 * `WEAR_SLOTS` order). Refused with no screen open.
 */
export type SlotCommand =
  /**
   * Left (0) or right (1) button on a slot, with Shift or not; slot −1 is a click outside the
   * screen's panel, which throws the cursor stack (left) or one of its items (right).
   */
  | {
      readonly type: 'slot.click';
      readonly slot: number;
      readonly button: 0 | 1;
      readonly shift: boolean;
    }
  /** A hotbar number key (`hotbar` 0–7) over a slot: swaps the two (refused with a cursor stack). */
  | { readonly type: 'slot.hotkey'; readonly slot: number; readonly hotbar: number };

/**
 * The open chest or station: `container.open` opens one (within 5 blocks, in sight, one player at
 * a time) as secondary on its block does.
 */
export type BlockEntityCommand =
  | { readonly type: 'container.open'; readonly x: number; readonly y: number; readonly z: number }
  /**
   * Flips the open station's « Keep burning » (a fire that allows it: `StationDef.keepLit`): each
   * click one flip, whatever the screen last showed.
   */
  | { readonly type: 'station.keepLit' };

/**
 * First slot number of the open block entity, or of the worn items, in slot commands (64): past
 * the largest inventory, whatever the player's size.
 */
export const OPEN_SLOTS_BASE = MAX_INVENTORY_SLOTS;

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
  /** Places a creature of the pack at a position (feet; `'surface'`: on the ground there). */
  | {
      readonly type: 'debug.spawn';
      readonly creature: string;
      readonly x: number;
      readonly y: number | 'surface';
      readonly z: number;
    }
  /** Kills a creature by its entity id: a death like any other (its loot drops). */
  | { readonly type: 'debug.killCreature'; readonly id: number }
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
