import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { t } from '../../../src/i18n/i18n.ts';
import { DEFAULT_BINDINGS, type KeyBindings } from '../../../src/input/bindings.ts';
import { KeyLabels } from '../../../src/input/keyLabels.ts';
import { ControlsScreen } from '../../../src/ui/screens/controls.ts';
import { type FakeElement, installFakeDom, removeFakeDom } from '../../helpers/fakeDom.ts';
import { type FakeTarget, installFakeWindow, removeFakeWindow } from '../../helpers/fakeTarget.ts';

/*
 * The Key bindings screen (docs « Settings » → réassignation): a click on a key slot waits for the
 * next key or for a mouse button pressed on that slot, conflicts and reserved keys are refused
 * with a line saying why, Esc cancels (except for the pause key), Reset restores the defaults.
 */

let win: FakeTarget;

beforeEach(() => {
  installFakeDom();
  win = installFakeWindow();
});
afterEach(() => {
  removeFakeWindow();
  removeFakeDom();
});

function setup(bindings: KeyBindings = DEFAULT_BINDINGS) {
  const changes: KeyBindings[] = [];
  let backs = 0;
  const labels = new KeyLabels('fr-FR');
  const screen = new ControlsScreen({
    label: (code) => labels.label(code),
    change: (next) => changes.push(next),
    back: () => backs++,
  });
  screen.show(bindings);
  const root = screen.element as unknown as FakeElement;
  const slot = (bind: string) =>
    root.findAll((element) => element.getAttribute('data-bind') === bind)[0]!;
  return {
    screen,
    changes,
    backs: () => backs,
    slot,
    status: () => root.querySelector('.controls-status')!.textContent,
    /** A key pressed while the page has the focus (the screen listens on the window). */
    key: (code: string, repeat = false) => {
      let stopped = false;
      win.dispatch('keydown', { code, key: code, repeat, stopPropagation: () => (stopped = true) });
      return stopped;
    },
    /** A mouse press on an element: the window's capture listener first, then the element's. */
    press: (target: FakeElement, button = 0) => {
      win.dispatch('mousedown', { target, button });
      target.dispatch('mousedown', { target, button, preventDefault() {} });
      if (button === 0) target.dispatch('click');
    },
  };
}

describe('ControlsScreen', () => {
  it('labels each slot of each action from the layout, as many slots as the defaults', () => {
    const s = setup();
    expect(s.slot('forward:0').textContent).toBe('Z');
    expect(s.slot('inventory:1').textContent).toBe(t('key.tab'));
    expect(s.slot('debug:2').textContent).toBe('<');
    expect(s.slot('jump:1')).toBeUndefined();
  });

  it('waits for a key after a click, takes it before anything else and applies it', () => {
    const s = setup();
    s.slot('jump:0').dispatch('click');
    expect(s.slot('jump:0').textContent).toBe(t('controls.waiting'));
    expect(s.slot('jump:0').classList.contains('waiting')).toBe(true);
    expect(s.status()).toBe(t('controls.press', { action: t('action.jump') }));
    expect(s.key('KeyJ')).toBe(true);
    expect(s.changes).toEqual([{ ...DEFAULT_BINDINGS, jump: ['KeyJ'] }]);
    expect(s.slot('jump:0').textContent).toBe('J');
    expect(s.status()).toBe('');
    // No longer waiting: the next key is left to the game.
    expect(s.key('KeyK')).toBe(false);
    expect(s.changes).toHaveLength(1);
  });

  it('refuses a key another action holds, and a reserved key, saying why', () => {
    const s = setup();
    s.slot('jump:0').dispatch('click');
    s.key('KeyW');
    expect(s.changes).toEqual([]);
    expect(s.status()).toBe(t('controls.taken', { key: 'Z', action: t('action.forward') }));
    expect(s.slot('jump:0').textContent).toBe(t('key.space'));
    s.slot('jump:0').dispatch('click');
    s.key('ControlLeft');
    s.slot('jump:0').dispatch('click');
    s.key('Digit2');
    expect(s.status()).toBe(t('controls.reserved', { key: '2' }));
    expect(s.changes).toEqual([]);
  });

  it('cancels on Esc and ignores repeats, but binds Esc to the pause slot', () => {
    const s = setup({ ...DEFAULT_BINDINGS, pause: ['KeyP'] });
    s.slot('jump:0').dispatch('click');
    expect(s.key('KeyJ', true)).toBe(true);
    expect(s.key('Escape')).toBe(true);
    expect(s.changes).toEqual([]);
    expect(s.slot('jump:0').textContent).toBe(t('key.space'));
    s.slot('pause:0').dispatch('click');
    s.key('Escape');
    expect(s.changes).toEqual([DEFAULT_BINDINGS]);
  });

  it('binds a mouse button pressed on the waiting slot; a press elsewhere stops waiting', () => {
    const s = setup();
    s.slot('sprint:0').dispatch('click');
    s.press(s.slot('sprint:0'), 1);
    expect(s.changes).toEqual([{ ...DEFAULT_BINDINGS, sprint: ['Mouse1'] }]);
    expect(s.slot('sprint:0').textContent).toBe(t('key.mouseMiddle'));
    // The left button ends its press with a click: that click does not wait again.
    s.slot('jump:0').dispatch('click');
    s.press(s.slot('jump:0'), 0);
    expect(s.status()).toBe(
      t('controls.taken', { key: t('key.mouseLeft'), action: t('action.primary') }),
    );
    expect(s.slot('jump:0').classList.contains('waiting')).toBe(false);
    // A press on another slot stops the wait there and waits on the new one.
    s.slot('jump:0').dispatch('click');
    s.press(s.slot('drop:0'));
    expect(s.slot('jump:0').classList.contains('waiting')).toBe(false);
    expect(s.slot('drop:0').classList.contains('waiting')).toBe(true);
    s.screen.stop();
    expect(s.key('KeyQ')).toBe(false);
    expect(s.slot('drop:0').textContent).toBe('G');
  });

  it('resets every key to its default', () => {
    const s = setup({ ...DEFAULT_BINDINGS, jump: ['KeyJ'], camera: ['KeyB'] });
    s.slot('drop:0').dispatch('click');
    (s.screen.element as unknown as FakeElement).findAction('reset-keys')!.dispatch('click');
    expect(s.changes).toEqual([DEFAULT_BINDINGS]);
    expect(s.slot('jump:0').textContent).toBe(t('key.space'));
    expect(s.status()).toBe(t('controls.restored'));
    expect(s.key('KeyQ')).toBe(false);
    (s.screen.element as unknown as FakeElement).findAction('back')!.dispatch('click');
    expect(s.backs()).toBe(1);
  });
});
