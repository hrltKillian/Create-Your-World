import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from '../../../src/input/bindings.ts';
import { InputManager } from '../../../src/input/InputManager.ts';
import { FakeTarget, installFakeWindow, removeFakeWindow } from '../../helpers/fakeTarget.ts';

const look = { yaw: 0, pitch: 0, addLook() {} };
let win: FakeTarget;
let input: InputManager;

beforeEach(() => {
  win = installFakeWindow();
  input = new InputManager(new FakeTarget() as unknown as HTMLElement, {
    pointerLock: false,
    language: 'en-US',
  });
});

afterEach(() => {
  input.dispose();
  removeFakeWindow();
});

const key = (type: 'keydown' | 'keyup', code: string, k: string) =>
  win.dispatch(type, { code, key: k, repeat: false });

describe('InputManager', () => {
  it('sends the client target only when there is one', () => {
    expect('target' in input.sample(look)).toBe(false);
    const target = { x: 1, y: 63, z: -2, face: 2 };
    expect(input.sample(look, target).target).toEqual(target);
  });

  it('keeps a tap that starts and ends between two ticks for one tick', () => {
    key('keydown', 'Space', ' ');
    key('keyup', 'Space', ' ');
    expect(input.sample(look).jump).toBe(true);
    expect(input.sample(look).jump).toBe(false);
  });

  it('reads movement by physical key whatever the printed letter', () => {
    key('keydown', 'KeyW', 'z');
    expect(input.sample(look).forward).toBe(1);
    key('keyup', 'KeyW', 'z');
    key('keydown', 'KeyW', 'w');
    expect(input.sample(look).forward).toBe(1);
    key('keyup', 'KeyW', 'w');
    expect(input.sample(look).forward).toBe(0);
  });

  it('ignores keys while disabled and forgets them on release', () => {
    input.enabled = false;
    key('keydown', 'Space', ' ');
    key('keyup', 'Space', ' ');
    key('keydown', 'KeyV', 'v');
    input.enabled = true;
    expect(input.sample(look).jump).toBe(false);
    expect(input.consume('camera')).toBe(false);
    key('keydown', 'KeyW', 'w');
    input.releaseAll();
    expect(input.sample(look).forward).toBe(0);
  });

  it('knows when either Shift key is held (Shift+G throws the stack)', () => {
    expect(input.shiftHeld()).toBe(false);
    key('keydown', 'ShiftRight', 'Shift');
    expect(input.shiftHeld()).toBe(true);
    key('keyup', 'ShiftRight', 'Shift');
    key('keydown', 'KeyG', 'g');
    expect(input.consume('drop')).toBe(true);
    expect(input.shiftHeld()).toBe(false);
  });

  it('sprints while forward stays held after a double tap within 300 ms', () => {
    const at = (type: 'keydown' | 'keyup', timeStamp: number) =>
      win.dispatch(type, { code: 'KeyW', key: 'w', repeat: false, timeStamp });
    at('keydown', 1000);
    at('keyup', 1080);
    expect(input.sample(look).sprint).toBe(false);
    at('keydown', 1250);
    expect(input.sample(look)).toMatchObject({ forward: 1, sprint: true });
    expect(input.sample(look).sprint).toBe(true);
    // Released: no more sprint; a lone press later walks.
    at('keyup', 4000);
    expect(input.sample(look).sprint).toBe(false);
    at('keydown', 5000);
    expect(input.sample(look)).toMatchObject({ forward: 1, sprint: false });
    // Too slow a second tap walks too.
    at('keyup', 5100);
    at('keydown', 5400);
    expect(input.sample(look).sprint).toBe(false);
    // Keys released in between (a screen opened): no double tap across it.
    at('keyup', 6000);
    input.releaseAll();
    at('keydown', 6100);
    expect(input.sample(look).sprint).toBe(false);
  });

  it('forgets the double-tap sprint once forward is released: a forced forward walks', () => {
    const at = (type: 'keydown' | 'keyup', timeStamp: number, code = 'KeyW') =>
      win.dispatch(type, { code, key: code, repeat: false, timeStamp });
    at('keydown', 1000);
    at('keyup', 1150);
    at('keydown', 1300);
    expect(input.sample(look).sprint).toBe(true);
    at('keyup', 1450);
    input.force('forward', 5);
    expect(input.sample(look)).toMatchObject({ forward: 1, sprint: false });
    // Another forward key still held keeps the sprint the double tap latched, until it goes up.
    input.bindings = { ...DEFAULT_BINDINGS, forward: ['KeyW', 'ArrowUp'] };
    at('keydown', 1600, 'ArrowUp');
    at('keydown', 1700);
    at('keyup', 1800);
    expect(input.sample(look).sprint).toBe(true);
    at('keyup', 1900, 'ArrowUp');
    expect(input.sample(look)).toMatchObject({ forward: 1, sprint: false });
  });

  it('holds forced actions for a number of ticks', () => {
    input.force('forward', 2);
    expect(input.sample(look).forward).toBe(1);
    input.tickForced();
    expect(input.sample(look).forward).toBe(1);
    input.tickForced();
    expect(input.sample(look).forward).toBe(0);
  });

  it('follows the bindings set at any time, with labels for the new keys', () => {
    input.bindings = { ...DEFAULT_BINDINGS, jump: ['KeyJ'], forward: ['ArrowUp'] };
    key('keydown', 'Space', ' ');
    key('keyup', 'Space', ' ');
    expect(input.sample(look).jump).toBe(false);
    key('keydown', 'KeyJ', 'j');
    key('keydown', 'ArrowUp', 'ArrowUp');
    const command = input.sample(look);
    expect(command.jump).toBe(true);
    expect(command.forward).toBe(1);
    expect(input.keyLabel('jump')).toBe('J');
  });

  it('crouches while held, or on and off with each press in toggle mode', () => {
    key('keydown', 'KeyC', 'c');
    expect(input.sample(look).crouch).toBe(true);
    key('keyup', 'KeyC', 'c');
    expect(input.sample(look).crouch).toBe(false);

    input.crouchToggle = true;
    key('keydown', 'KeyC', 'c');
    key('keyup', 'KeyC', 'c');
    expect(input.sample(look).crouch).toBe(true);
    expect(input.sample(look).crouch).toBe(true);
    key('keydown', 'KeyC', 'c');
    expect(input.sample(look).crouch).toBe(false);
    key('keyup', 'KeyC', 'c');
    // Automation still holds it for some ticks; a release of every key stands up.
    input.force('crouch', 1);
    expect(input.sample(look).crouch).toBe(true);
    input.tickForced();
    key('keydown', 'KeyC', 'c');
    input.releaseAll();
    expect(input.sample(look).crouch).toBe(false);
  });

  it("cancels a bound key's browser action, but not the pause key's or a shortcut's", () => {
    const prevented: string[] = [];
    const press = (code: string, extra: Record<string, unknown> = {}) =>
      win.dispatch('keydown', {
        code,
        key: code,
        repeat: false,
        ...extra,
        preventDefault: () => prevented.push(code),
      });
    press('Space');
    press('Tab');
    press('Escape');
    press('KeyQ');
    press('KeyW', { ctrlKey: true });
    press('KeyE', { metaKey: true });
    expect(prevented).toEqual(['Space', 'Tab']);
    input.bindings = { ...DEFAULT_BINDINGS, drop: ['Slash'] };
    press('Slash');
    expect(prevented).toEqual(['Space', 'Tab', 'Slash']);
  });
});
