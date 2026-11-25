import type { QuestDef } from '../../content/schema.ts';
import type { Command } from '../commands.ts';
import type { SimView } from '../host.ts';

/*
 * What the quests walk (questWalk.ts) needs of a play session: the browser's, through
 * `__game`'s automation (selftest/questsWalk.ts), or an inline simulation's (tests).
 */

export interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type Cell = Point;

/** What the walk holds down: mining or a blow, a placement or a use, a step forward. */
export type HoldAction = 'primary' | 'secondary' | 'forward';

export interface WalkPort {
  readonly view: SimView;
  /** Sends a command of the local player and applies it, with one tick. */
  send(command: Command): void;
  /** Runs `ticks` ticks. */
  step(ticks: number): void;
  /**
   * Holds an action for `ticks` ticks (fewer once `until` holds, tested before each one) with a
   * hotbar slot selected and the view on a point, then lets it go for a tick.
   */
  hold(
    action: HoldAction,
    slot: number,
    at: Point,
    ticks: number,
    until?: () => boolean,
  ): Promise<void>;
  /** Teleports the player (feet at `y`, or on the ground) and waits until the place is loaded. */
  travel(x: number, y: number | 'surface', z: number): Promise<void>;
}

export interface WalkOptions {
  /** How far from home a biome is looked for (blocks). */
  readonly searchRadius: number;
  /** Called once each quest is done and the player is home again (the browser's HUD checks). */
  readonly onDone?: (quest: QuestDef, index: number) => Promise<void> | void;
}

/** A cell for messages. */
export function cellText(c: Cell): string {
  return `(${c.x}, ${c.y}, ${c.z})`;
}
