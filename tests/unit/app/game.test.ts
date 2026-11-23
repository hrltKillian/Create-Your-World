import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BOOT_PARAMS } from '../../../src/app/bootParams.ts';
import { Game, type GameHost } from '../../../src/app/Game.ts';
import type { FrameStats } from '../../../src/app/perf.ts';
import type { AudioEngine } from '../../../src/audio/AudioEngine.ts';
import type { InputManager } from '../../../src/input/InputManager.ts';
import type { WorkerPool } from '../../../src/platform/WorkerPool.ts';
import { lockWorld } from '../../../src/platform/worldLock.ts';
import { type FakeElement, installFakeDom, removeFakeDom } from '../../helpers/fakeDom.ts';
import { installFakeWindow, removeFakeWindow } from '../../helpers/fakeTarget.ts';
import { registry } from '../../helpers/registry.ts';
import { RecordingStorage, zlibDeflater } from '../../helpers/save.ts';
import { createTestWorldView } from '../../helpers/worldView.ts';

/** The input, as far as the menus, the pause and the free camera touch it. */
const input = {
  sensitivity: 1,
  invertY: false,
  enabled: false,
  pointer: false,
  slot: 0,
  releaseAll: () => {},
};
/** Columns never arrive: the world stays on its loading screen, which is enough here. */
const pool = { size: 1, run: () => new Promise(() => {}) };
const audio = { setVolumes: () => {}, setListener: () => {}, playUi: () => {} };

/** A Game over stand-ins (no WebGL, workers or sound) in a fake page, saving into `storage`. */
function setup() {
  const win = installFakeWindow();
  const storage = new RecordingStorage();
  const failures: unknown[] = [];
  let loop: ((dt: number) => void) | null = null;
  const root = document.createElement('div');
  const host: GameHost = {
    root,
    // The free camera plays without click-to-play or the bag (no Pointer Lock under Node).
    params: { ...DEFAULT_BOOT_PARAMS, freecam: true, worldType: 'flat', rd: 2 },
    registry,
    workers: pool as unknown as WorkerPool,
    view: createTestWorldView().view,
    input: input as unknown as InputManager,
    audio: audio as unknown as AudioEngine,
    layers: [],
    layoutLoaded: Promise.resolve(),
    frames: { span: () => {} } as unknown as FrameStats,
    touchOnly: false,
    xray: () => false,
    runLoop: (frame) => {
      loop = frame;
    },
    stopLoop: () => {
      loop = null;
    },
    shown: () => {},
    fail: (error) => failures.push(error),
    recordError: (message) => failures.push(message),
  };
  const game = new Game(host, { storage, deflater: zlibDeflater, unavailable: false });
  const pauseMenu = game.menus.element as unknown as FakeElement;
  return {
    game,
    storage,
    failures,
    win,
    root: root as unknown as FakeElement,
    running: () => loop !== null,
    failedShown: () => !pauseMenu.querySelector('.pause-failed')!.hidden,
    button: (action: string) => pauseMenu.findAction(action)!,
  };
}

/** A new world, paused: the pause menu is up (its own save written). */
async function pausedWorld(s: ReturnType<typeof setup>) {
  await s.game.createWorld({ name: 'Quit test', seed: 'quit', hostiles: true });
  s.game.pause();
  const open = s.game.open!;
  await open.saves.save();
  expect(s.game.state).toBe('paused');
  return { open, id: open.info.id, layers: s.root.childNodes.length };
}

describe('save & quit', () => {
  beforeEach(() => {
    installFakeDom();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    removeFakeWindow();
    removeFakeDom();
  });

  it('keeps the world open behind the pause menu when the last save fails', async () => {
    const s = setup();
    const { open, id, layers } = await pausedWorld(s);
    s.storage.failure = new Error('The disk went away');
    expect(await s.game.saveAndQuit()).toBe(false);
    expect(s.game.state).toBe('paused');
    expect(s.game.open).toBe(open);
    expect(s.running()).toBe(true);
    expect(s.root.childNodes).toHaveLength(layers); // the play layer is still there
    expect(await lockWorld(id)).toBeNull(); // still held by this tab
    expect(s.failedShown()).toBe(true);
    expect(s.button('retry-save-quit').disabled).toBe(false);
    expect(s.button('resume').disabled).toBe(false);
    // Its saves go on: the page hiding writes at once.
    const writes = s.storage.batches.length;
    s.win.dispatch('pagehide', {});
    expect(s.storage.batches).toHaveLength(writes + 1);

    s.storage.failure = null;
    expect(await s.game.saveAndQuit()).toBe(true);
    expect(s.game.state).toBe('menu');
    expect(s.game.open).toBeNull();
    expect(s.running()).toBe(false);
    expect(s.root.childNodes).toHaveLength(layers - 1);
    expect((await s.storage.listWorlds()).map((w) => w.id)).toEqual([id]);
    const lock = await lockWorld(id);
    expect(lock).not.toBeNull();
    await lock!.release();
    expect(s.failures).toEqual([]);
  });

  it('hides the failure once a later save of the open world succeeds', async () => {
    const s = setup();
    const { open } = await pausedWorld(s);
    s.storage.failure = new Error('The disk went away');
    expect(await s.game.saveAndQuit()).toBe(false);
    expect(s.failedShown()).toBe(true);
    s.storage.failure = null;
    expect(await open.saves.save()).toBe(true);
    expect(s.failedShown()).toBe(false);
    expect(s.game.state).toBe('paused');
  });

  it('quits without saving once the last save failed, and saves no more', async () => {
    const s = setup();
    const { id } = await pausedWorld(s);
    s.storage.failure = new Error('The disk went away');
    expect(await s.game.saveAndQuit()).toBe(false);
    const writes = s.storage.batches.length;
    await s.game.quitWithoutSaving();
    expect(s.game.state).toBe('menu');
    expect(s.game.open).toBeNull();
    s.win.dispatch('pagehide', {});
    await vi.advanceTimersByTimeAsync(120_000);
    expect(s.storage.batches).toHaveLength(writes);
    const lock = await lockWorld(id);
    expect(lock).not.toBeNull();
    await lock!.release();
    expect(s.failures).toEqual([]);
  });

  it('opens the pause menu again without the failure', async () => {
    const s = setup();
    await pausedWorld(s);
    s.storage.failure = new Error('The disk went away');
    await s.game.saveAndQuit();
    expect(s.failedShown()).toBe(true);
    s.game.menus.openPause('Quit test');
    expect(s.failedShown()).toBe(false);
    s.storage.failure = null;
    expect(await s.game.saveAndQuit()).toBe(true);
  });
});
