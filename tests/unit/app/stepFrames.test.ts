import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../../src/app/App.ts';
import { AudioBridge } from '../../../src/app/AudioBridge.ts';
import { stepFrames } from '../../../src/app/selftest/m11audio.ts';
import { AudioEngine } from '../../../src/audio/AudioEngine.ts';
import { EYE_HEIGHT, STRIDE } from '../../../src/core/player.ts';
import type { CameraPose } from '../../../src/render/WorldView.ts';
import { registry } from '../../helpers/registry.ts';
import { playerTestSim } from '../../helpers/simHarness.ts';

/**
 * A display refreshing `hz` times a second, its wall time faked: each refresh the game's frame
 * runs, then the frame callbacks. The returned function refreshes until `work` settles.
 */
function display(hz: number, gameFrame: () => void) {
  let now = 0;
  let callbacks: FrameRequestCallback[] = [];
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  return async (work: Promise<void>): Promise<void> => {
    let done = false;
    const settled = () => {
      done = true;
    };
    work.then(settled, settled);
    while (!done) {
      // The automation runs on to its next frame wait.
      await new Promise((resolve) => setImmediate(resolve));
      if (done) break;
      now += 1000 / hz;
      gameFrame();
      const due = callbacks;
      callbacks = [];
      for (const callback of due) callback(now);
    }
    await work;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('stepFrames (the audio selftest steps two ticks a frame)', () => {
  it.each([60, 144, 240, 360])('logs one footstep a stride on a %i Hz display', async (hz) => {
    const s = playerTestSim({ seed: 'steps' });
    const audio = new AudioEngine(registry.pack.sfx ?? [], { muted: true });
    const bridge = new AudioBridge(audio, s.host.view);
    const pose: CameraPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    const body = s.player.body;
    const refresh = display(hz, () => {
      pose.x = body.x;
      pose.y = body.y + EYE_HEIGHT;
      pose.z = body.z;
      bridge.frame(1 / hz, pose, { rain: 0 });
    });
    // The case's walk: forward held, two ticks a frame (fixed steps).
    const app = { session: { step: (n: number) => s.tick(n, { forward: 1 }) } } as unknown as App;
    await refresh(stepFrames(app, 1, 0));
    const from = body.z;
    await refresh(stepFrames(app, 60, 2));
    const strides = Math.floor((from - body.z) / STRIDE);
    const step = registry.blockSfx(s.sim.world.getBlock(0, 64, 0), 'step');
    expect(strides).toBeGreaterThanOrEqual(5);
    expect(audio.log().filter((key) => key === step)).toHaveLength(strides);
  });
});
