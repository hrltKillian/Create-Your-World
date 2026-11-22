/** Commands are the only way to change simulation state (they could travel over a network). */
export type Command = {
  readonly type: 'client.view';
  /** Block position the client's camera or player is at. */
  readonly x: number;
  readonly z: number;
  /** Render distance in columns. */
  readonly radius: number;
};

export interface StampedCommand {
  readonly playerId: number;
  readonly seq: number;
  readonly command: Command;
}
