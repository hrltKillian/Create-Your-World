import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FreeCam } from '../../../src/app/FreeCam.ts';
import { PITCH_LIMIT } from '../../../src/core/angles.ts';
import { InputManager } from '../../../src/input/InputManager.ts';
import { FakeTarget, installFakeWindow, removeFakeWindow } from '../../helpers/fakeTarget.ts';

let win: FakeTarget;
let canvas: FakeTarget;
let input: InputManager;
let cam: FreeCam;

beforeEach(() => {
  win = installFakeWindow();
  canvas = new FakeTarget();
  input = new InputManager(canvas as unknown as HTMLElement, {
    pointerLock: false,
    language: 'en-US',
  });
  cam = new FreeCam(input, { x: 0, y: 100, z: 0, yaw: 0, pitch: 0 });
});

afterEach(() => {
  input.dispose();
  removeFakeWindow();
});

const hold = (code: string) => win.dispatch('keydown', { code, key: '', repeat: false });

describe('FreeCam', () => {
  it('flies with the movement keys along the view direction', () => {
    hold('KeyW');
    cam.update(0.5);
    expect(cam.pose.z).toBeCloseTo(-6);
    expect(cam.pose.x).toBeCloseTo(0);
    hold('KeyD');
    cam.update(0.5);
    expect(cam.pose.x).toBeCloseTo(6);
  });

  it('rises with jump, sinks with crouch and goes four times faster with sprint', () => {
    hold('Space');
    cam.update(1);
    expect(cam.pose.y).toBeCloseTo(112);
    hold('ShiftLeft');
    cam.update(1);
    expect(cam.pose.y).toBeCloseTo(160);
    win.dispatch('keyup', { code: 'Space' });
    hold('KeyC');
    cam.update(0.25);
    expect(cam.pose.y).toBeCloseTo(148);
  });

  it('looks around by dragging without Pointer Lock and clamps the pitch', () => {
    win.dispatch('mousemove', { movementX: 100, movementY: 0 });
    cam.update(0);
    expect(cam.pose.yaw).toBe(0);
    canvas.dispatch('mousedown', { button: 0 });
    win.dispatch('mousemove', { movementX: 100, movementY: 40 });
    cam.update(0);
    expect(cam.pose.yaw).toBeCloseTo(-0.25);
    expect(cam.pose.pitch).toBeCloseTo(-0.1);
    win.dispatch('mousemove', { movementX: 0, movementY: -10_000 });
    cam.update(0);
    expect(cam.pose.pitch).toBeCloseTo(PITCH_LIMIT);
  });
});
