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

/** Developer commands, refused unless the world rules allow debugging. */
export type DebugCommand =
  | {
      readonly type: 'debug.teleport';
      readonly x: number;
      readonly y: number | 'surface';
      readonly z: number;
    }
  | { readonly type: 'debug.setStat'; readonly stat: 'stamina'; readonly value: number }
  /** Adds items to the player's inventory (what does not fit drops at the player's feet). */
  | { readonly type: 'debug.give'; readonly item: string; readonly count: number }
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
