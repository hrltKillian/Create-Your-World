import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InputManager } from '../../../src/input/InputManager.ts';

/** Minimal window/element stand-ins: the manager only adds and removes listeners. */
class Target {
  private readonly listeners = new Map<string, Set<(e: unknown) => void>>();
  addEventListener(type: string, fn: (e: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string, event: Record<string, unknown>) {
    for (const fn of this.listeners.get(type) ?? []) fn({ preventDefault() {}, ...event });
  }
}

const look = { yaw: 0, pitch: 0, addLook() {} };
let win: Target;
let input: InputManager;

beforeEach(() => {
  win = new Target();
  (globalThis as unknown as { window: Target }).window = win;
  input = new InputManager(new Target() as unknown as HTMLElement, {
    pointerLock: false,
    language: 'en-US',
  });
});

afterEach(() => {
  input.dispose();
  delete (globalThis as { window?: unknown }).window;
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
