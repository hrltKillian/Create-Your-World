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
  | DebugCommand;

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
  readonly slot: number;
}

/** Developer commands, refused unless the world rules allow debugging. */
export type DebugCommand =
  | {
      readonly type: 'debug.teleport';
      readonly x: number;
      readonly y: number | 'surface';
      readonly z: number;
    }
  | { readonly type: 'debug.setStat'; readonly stat: 'stamina'; readonly value: number }
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
