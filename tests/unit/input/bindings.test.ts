import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  actionForCode,
  bindable,
  DEFAULT_BINDINGS,
  HOTBAR_CODES,
  RESERVED_CODES,
  readBindings,
  rebind,
} from '../../../src/input/bindings.ts';

/*
 * Key bindings (docs « Entrées », « Settings » → réassignation): which codes an action may take,
 * rebinding one key slot with conflicts refused (never swapped), and the stored bindings checked
 * action by action.
 */

describe('key bindings', () => {
  it('lists every action once, each bound by default to codes it may take, none twice', () => {
    expect(new Set(ACTIONS).size).toBe(ACTIONS.length);
    expect(Object.keys(DEFAULT_BINDINGS).sort()).toEqual([...ACTIONS].sort());
    const codes = ACTIONS.flatMap((action) => DEFAULT_BINDINGS[action]);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(bindable(code), code).toBe(true);
    expect(actionForCode(DEFAULT_BINDINGS, 'Tab')).toBe('inventory');
    expect(actionForCode(DEFAULT_BINDINGS, 'KeyQ')).toBeNull();
  });

  it('never binds Ctrl, Cmd, Alt, F5, F11, F12, the hotbar digits or the side mouse buttons', () => {
    for (const code of [...RESERVED_CODES, ...HOTBAR_CODES, 'Mouse3', 'Mouse4', '', 'keyw'])
      expect(bindable(code), code).toBe(false);
    for (const code of ['KeyQ', 'ArrowUp', 'Numpad5', 'ShiftRight', 'F1', 'Digit9', 'Mouse1'])
      expect(bindable(code), code).toBe(true);
  });

  it('binds a free key to one slot of an action, the other slots unchanged', () => {
    const result = rebind(DEFAULT_BINDINGS, 'inventory', 1, 'KeyI');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bindings.inventory).toEqual(['KeyE', 'KeyI']);
    expect(result.bindings.jump).toBe(DEFAULT_BINDINGS.jump);
    expect(DEFAULT_BINDINGS.inventory).toEqual(['KeyE', 'Tab']);
    expect(rebind(result.bindings, 'primary', 0, 'Tab').ok).toBe(true);
    // The same key again changes nothing.
    expect(rebind(DEFAULT_BINDINGS, 'jump', 0, 'Space')).toEqual({
      ok: true,
      bindings: DEFAULT_BINDINGS,
    });
  });

  it('refuses a key another slot holds, of another action or of the same one', () => {
    expect(rebind(DEFAULT_BINDINGS, 'jump', 0, 'KeyW')).toEqual({
      ok: false,
      reason: 'taken',
      by: 'forward',
    });
    expect(rebind(DEFAULT_BINDINGS, 'inventory', 0, 'Tab')).toEqual({
      ok: false,
      reason: 'taken',
      by: 'inventory',
    });
    expect(rebind(DEFAULT_BINDINGS, 'forward', 0, 'Escape')).toMatchObject({ by: 'pause' });
  });

  it('refuses a code no action may take, and a slot the action does not have', () => {
    expect(rebind(DEFAULT_BINDINGS, 'jump', 0, 'ControlLeft')).toEqual({
      ok: false,
      reason: 'reserved',
    });
    expect(rebind(DEFAULT_BINDINGS, 'jump', 0, 'Digit3')).toMatchObject({ reason: 'reserved' });
    expect(rebind(DEFAULT_BINDINGS, 'jump', 1, 'KeyJ')).toMatchObject({ reason: 'reserved' });
  });

  it('reads stored bindings action by action, and the defaults when a code is bound twice', () => {
    const stored = { ...DEFAULT_BINDINGS, jump: ['KeyJ'], debug: ['F1', 'F2', 'KeyO'] };
    expect(readBindings(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    const read = readBindings({
      ...stored,
      forward: ['KeyW', 'KeyZ'], // more slots than its default
      back: ['F12'], // reserved
      left: 'KeyA', // not a list
      crouch: [4],
    });
    expect(read).toEqual({
      ...stored,
      forward: ['KeyW'],
      back: ['KeyS'],
      left: ['KeyA'],
      crouch: ['KeyC'],
    });
    expect(readBindings({ ...DEFAULT_BINDINGS, jump: ['KeyW'] })).toBe(DEFAULT_BINDINGS);
    // An action back on its default may meet the key another one took.
    expect(readBindings({ ...stored, jump: ['KeyW'], forward: ['F12'] })).toBe(DEFAULT_BINDINGS);
    expect(readBindings(undefined)).toEqual(DEFAULT_BINDINGS);
    expect(readBindings('KeyW')).toEqual(DEFAULT_BINDINGS);
  });
});
