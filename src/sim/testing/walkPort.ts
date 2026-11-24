import type { ObjectiveDef } from '../../content/schema.ts';
import type { Command } from '../commands.ts';
import type { SimView } from '../host.ts';

/*
 * What the objectives walk (objectiveWalk.ts) needs of a play session: the browser's, through
 * `__game`'s automation (selftest/objectivesWalk.ts), or an inline simulation's (tests).
 */

export interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type Cell = Point;

export interface WalkPort {
  readonly view: SimView;
  /** Sends a command of the local player and applies it, with one tick. */
  send(command: Command): void;
  /** Runs `ticks` ticks. */
  step(ticks: number): void;
  /**
   * Holds secondary for `ticks` ticks with a hotbar slot selected and the view on a point, then
   * lets it go for a tick.
   */
  use(slot: number, at: Point, ticks: number): Promise<void>;
  /** Teleports the player (feet at `y`, or on the ground) and waits until the place is loaded. */
  travel(x: number, y: number | 'surface', z: number): Promise<void>;
}

export interface WalkOptions {
  /** How far from home a biome is looked for (blocks). */
  readonly searchRadius: number;
  /** Called once each objective is done and the player is home again (the browser's HUD checks). */
  readonly onDone?: (objective: ObjectiveDef, index: number) => Promise<void> | void;
}

/** A cell for messages. */
export function cellText(c: Cell): string {
  return `(${c.x}, ${c.y}, ${c.z})`;
}
