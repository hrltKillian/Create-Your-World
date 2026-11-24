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

/** Every action, in the order the Key bindings screen lists them. */
export const ACTIONS: readonly Action[] = [
  'forward',
  'back',
  'left',
  'right',
  'jump',
  'sprint',
  'crouch',
  'primary',
  'secondary',
  'inventory',
  'drop',
  'camera',
  'debug',
  'pause',
];

/** The codes bound to each action. An action keeps as many key slots as its default has. */
export type KeyBindings = Readonly<Record<Action, readonly string[]>>;

export const DEFAULT_BINDINGS: KeyBindings = {
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

/** Mouse buttons an action can take: left, middle and right (the side buttons navigate back). */
export const MOUSE_CODES: readonly string[] = ['Mouse0', 'Mouse1', 'Mouse2'];

/**
 * Actions read from key presses only (the bag, the debug overlay, pause and back listen to
 * keydown): a mouse button bound to one would do nothing.
 */
const KEY_ONLY: readonly Action[] = ['inventory', 'debug', 'pause'];

/**
 * A code `action` may take: a key, or a MOUSE_CODES button unless the action is KEY_ONLY; never a
 * reserved or a hotbar key.
 */
export function bindable(code: string, action: Action): boolean {
  if (code.startsWith('Mouse')) return MOUSE_CODES.includes(code) && !KEY_ONLY.includes(action);
  return (
    /^[A-Z][A-Za-z0-9]{0,31}$/.test(code) &&
    !RESERVED_CODES.has(code) &&
    !HOTBAR_CODES.includes(code)
  );
}

export function actionForCode(bindings: KeyBindings, code: string): Action | null {
  for (const action of ACTIONS) if (bindings[action].includes(code)) return action;
  return null;
}

/**
 * What a rebinding did: the new bindings, or why it was refused (`keyOnly`: a mouse button for a
 * KEY_ONLY action).
 */
export type Rebinding =
  | { readonly ok: true; readonly bindings: KeyBindings }
  | { readonly ok: false; readonly reason: 'reserved' | 'keyOnly' }
  | { readonly ok: false; readonly reason: 'taken'; readonly by: Action };

/**
 * Binds `code` to key slot `slot` of `action`. A conflict is refused, never swapped: a code that
 * another slot (of any action) holds stays there, so no key moves unless the player moves it, and
 * Esc never lands on another action by a swap.
 */
export function rebind(
  bindings: KeyBindings,
  action: Action,
  slot: number,
  code: string,
): Rebinding {
  const codes = bindings[action];
  if (slot < 0 || slot >= codes.length) return { ok: false, reason: 'reserved' };
  // A MOUSE_CODES button is refused only for a KEY_ONLY action.
  if (!bindable(code, action))
    return { ok: false, reason: MOUSE_CODES.includes(code) ? 'keyOnly' : 'reserved' };
  if (codes[slot] === code) return { ok: true, bindings };
  const by = actionForCode(bindings, code);
  if (by) return { ok: false, reason: 'taken', by };
  return { ok: true, bindings: { ...bindings, [action]: codes.with(slot, code) } };
}

/**
 * Bindings from stored data: an action keeps its stored codes when it may take them all and they
 * are as many as its default's, else it gets its default. A code bound twice gives the defaults.
 */
export function readBindings(data: unknown): KeyBindings {
  const stored = (data ?? {}) as Partial<Record<Action, unknown>>;
  const out = {} as Record<Action, readonly string[]>;
  const seen = new Set<string>();
  for (const action of ACTIONS) {
    const value = stored[action];
    const valid =
      Array.isArray(value) &&
      value.length === DEFAULT_BINDINGS[action].length &&
      value.every((code) => typeof code === 'string' && bindable(code, action));
    out[action] = valid ? [...(value as string[])] : DEFAULT_BINDINGS[action];
    for (const code of out[action]) {
      if (seen.has(code)) return DEFAULT_BINDINGS;
      seen.add(code);
    }
  }
  return out;
}
