import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  it('holds forced actions for a number of ticks', () => {
    input.force('forward', 2);
    expect(input.sample(look).forward).toBe(1);
    input.tickForced();
    expect(input.sample(look).forward).toBe(1);
    input.tickForced();
    expect(input.sample(look).forward).toBe(0);
  });
});
