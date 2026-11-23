/**
 * Where the app is (pure): its state machine (menu → loading → world ⇄ paused ⇄ quitting → menu)
 * and the stack of menu screens. The App asks `nextState` before every change and ignores an event its
 * state does not take (a second pause, a resume while loading…).
 */

export type AppState =
  | 'boot'
  | 'unsupported'
  | 'fatal'
  | 'title'
  | 'testchunk'
  | 'menu'
  | 'loading'
  | 'world'
  | 'paused'
  /** Save & quit: the last save is being written. */
  | 'quitting';

export type AppEvent =
  /** The menus show (after the boot, a failed opening, or save & quit). */
  | 'menu'
  /** Save & quit, or Quit without saving (from the pause menu). */
  | 'quit'
  /** The last save failed: the world stays open behind the pause menu. */
  | 'quitFailed'
  /** A world is being opened (lock, records, the area around the player). */
  | 'open'
  /** The area around the player is ready. */
  | 'loaded'
  /** The player landed in an unloaded area (teleport, respawn far away). */
  | 'unloaded'
  | 'pause'
  | 'resume';

const TRANSITIONS: Readonly<Record<AppEvent, { from: readonly AppState[]; to: AppState }>> = {
  menu: { from: ['boot', 'loading', 'quitting'], to: 'menu' },
  quit: { from: ['paused'], to: 'quitting' },
  quitFailed: { from: ['quitting'], to: 'paused' },
  open: { from: ['boot', 'menu'], to: 'loading' },
  loaded: { from: ['loading'], to: 'world' },
  unloaded: { from: ['world'], to: 'loading' },
  pause: { from: ['loading', 'world'], to: 'paused' },
  // Back to play; the frame loop turns it into 'loading' again if the area is not ready.
  resume: { from: ['paused'], to: 'world' },
};

/** The state after `event`, or null when `state` does not take it. */
export function nextState(state: AppState, event: AppEvent): AppState | null {
  const rule = TRANSITIONS[event];
  return rule.from.includes(state) ? rule.to : null;
}

/** Menu screens: 'main' and 'pause' are roots (main menu, pause menu), the others open on top. */
export type MenuScreen = 'main' | 'worlds' | 'newWorld' | 'settings' | 'pause';

/** The stack of open menu screens (Esc and Back go down one). */
export class MenuNav {
  private readonly stack: MenuScreen[] = [];

  /** The screen shown, null when the menus are closed. */
  get current(): MenuScreen | null {
    return this.stack.at(-1) ?? null;
  }

  /** Starts over on a root screen. */
  reset(root: MenuScreen): void {
    this.stack.length = 0;
    this.stack.push(root);
  }

  /** Opens a screen on top (nothing happens if it is already shown). */
  open(screen: MenuScreen): void {
    if (this.current !== screen) this.stack.push(screen);
  }

  /** Back one screen; false at the root (the caller decides: resume, or nothing). */
  back(): boolean {
    if (this.stack.length <= 1) return false;
    this.stack.pop();
    return true;
  }

  close(): void {
    this.stack.length = 0;
  }
}
