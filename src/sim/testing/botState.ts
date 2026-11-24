import type { InputCommand } from '../commands.ts';
import type { Target } from './botSenses.ts';

/* What the wanderMineBuild bot is doing, its state and the input it sends from it. */

export type Task = 'walk' | 'mine' | 'dig' | 'build' | 'eat' | 'seek';

/** Buttons of an input (bit flags). */
export const FORWARD = 1;
export const JUMP = 2;
export const SPRINT = 4;
export const CROUCH = 8;
export const PRIMARY = 16;
export const SECONDARY = 32;
export const BACK = 64;

/** Ticks without moving before a walking bot jumps. */
export const JUMP_AFTER = 3;

export interface BotState extends Target {
  task: Task;
  /**
   * Tick the task (or its acting phase: a search within reach) started: its first tick releases
   * the use buttons, so each starts with a press (eating, a gate).
   */
  start: number;
  until: number;
  yaw: number;
  pitch: number;
  /** Yaw turned per tick while building (a curved wall). */
  turn: number;
  sprint: boolean;
  slot: number;
  /** eat: FOOD or DRINK; seek: WATER or BUSH. */
  want: number;
  /** seek: within reach of the target. */
  close: boolean;
  /** Ticks left of a climb (walk, seek): jumping and placing the hotbar's block under the feet. */
  climb: number;
  /** Where the bot heads when its searches find nothing (a new way after each death). */
  roam: number;
  /** Earliest tick of the next search, by source kind. */
  readonly scanAt: number[];
  lastX: number;
  lastZ: number;
  /** Ticks in a row without moving on the ground plane. */
  stuck: number;
  /** End of the current progress window, and where it started. */
  checkAt: number;
  checkX: number;
  checkZ: number;
}

/** A bot walking nowhere yet, that roams towards `roam` when it finds nothing it needs. */
export function newBotState(roam: number): BotState {
  return {
    task: 'walk',
    start: 0,
    until: 0,
    yaw: 0,
    pitch: 0,
    turn: 0,
    sprint: false,
    slot: 0,
    want: 0,
    close: false,
    climb: 0,
    roam,
    scanAt: [0, 0, 0],
    tx: 0,
    ty: 0,
    tz: 0,
    lastX: Number.NaN,
    lastZ: Number.NaN,
    stuck: 0,
    checkAt: 0,
    checkX: 0,
    checkZ: 0,
  };
}

export function begin(s: BotState, task: Task, tick: number, ticks: number): void {
  s.task = task;
  s.start = tick;
  s.until = tick + ticks;
  s.stuck = 0;
  s.climb = 0;
}

export function startWalk(s: BotState, tick: number, yaw: number, ticks: number): void {
  begin(s, 'walk', tick, ticks);
  s.yaw = yaw;
  s.pitch = 0;
}

/**
 * This tick's input: the task's buttons, whose use buttons its first tick releases (eating starts
 * on a press). A held jump jumps again on each landing.
 */
export function input(s: BotState, tick: number, buttons: number): InputCommand {
  const held = tick > s.start ? buttons : buttons & ~(PRIMARY | SECONDARY);
  return {
    type: 'input',
    forward: (held & FORWARD) !== 0 ? 1 : (held & BACK) !== 0 ? -1 : 0,
    strafe: 0,
    jump: (held & JUMP) !== 0,
    sprint: (held & SPRINT) !== 0,
    crouch: (held & CROUCH) !== 0,
    yaw: s.yaw,
    pitch: s.pitch,
    primary: (held & PRIMARY) !== 0,
    secondary: (held & SECONDARY) !== 0,
    slot: s.slot,
  };
}
