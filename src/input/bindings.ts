import { HOTBAR_SLOTS } from '../core/player.ts';

/**
 * Actions bound by physical key position (KeyboardEvent.code): the same keys work on every layout
 * (ZQSD on AZERTY is WASD on QWERTY). Only the displayed labels change.
 */
export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sprint'
  | 'crouch'
  | 'primary'
  | 'secondary'
  | 'inventory'
  | 'drop'
  | 'camera'
  | 'debug'
  | 'pause';

export const DEFAULT_BINDINGS: Readonly<Record<Action, readonly string[]>> = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  jump: ['Space'],
  sprint: ['ShiftLeft'],
  crouch: ['KeyC'],
  primary: ['Mouse0'],
  secondary: ['Mouse2'],
  inventory: ['KeyE', 'Tab'],
  drop: ['KeyG'],
  camera: ['KeyV'],
  debug: ['F3', 'Backquote', 'IntlBackslash'],
  pause: ['Escape'],
};

/** Hotbar slot keys, Digit1 for the first slot (always labelled with digits). */
export const HOTBAR_CODES: readonly string[] = Array.from(
  { length: HOTBAR_SLOTS },
  (_, i) => `Digit${i + 1}`,
);

/** Keys the game never binds (browser and system shortcuts). */
export const RESERVED_CODES: ReadonlySet<string> = new Set([
  'ControlLeft',
  'ControlRight',
  'MetaLeft',
  'MetaRight',
  'AltLeft',
  'AltRight',
  'F5',
  'F11',
  'F12',
]);

export function actionForCode(
  bindings: Readonly<Record<Action, readonly string[]>>,
  code: string,
): Action | null {
  for (const [action, codes] of Object.entries(bindings) as [Action, readonly string[]][]) {
    if (codes.includes(code)) return action;
  }
  return null;
}
