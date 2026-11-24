import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BootParams, DEFAULT_BOOT_PARAMS } from '../../../src/app/bootParams.ts';
import { Game, type GameHost } from '../../../src/app/Game.ts';
import type { FrameStats } from '../../../src/app/perf.ts';
import { AudioEngine } from '../../../src/audio/AudioEngine.ts';
import { DEFAULT_BINDINGS, type KeyBindings } from '../../../src/input/bindings.ts';
import type { InputManager } from '../../../src/input/InputManager.ts';
import { KeyLabels } from '../../../src/input/keyLabels.ts';
import { DEFAULT_SETTINGS, SETTINGS_KEY, writeSettings } from '../../../src/platform/settings.ts';
import type { WorkerPool } from '../../../src/platform/WorkerPool.ts';
import { lockWorld } from '../../../src/platform/worldLock.ts';
import { type FakeElement, installFakeDom, removeFakeDom } from '../../helpers/fakeDom.ts';
import { installFakeWindow, removeFakeWindow } from '../../helpers/fakeTarget.ts';
import { registry } from '../../helpers/registry.ts';
import { RecordingStorage, zlibDeflater } from '../../helpers/save.ts';
import { createTestWorldView } from '../../helpers/worldView.ts';

/** The input, as far as the menus, the pause, the settings and the free camera touch it. */
const input = {
  sensitivity: 1,
  invertY: false,
  crouchToggle: false,
  bindings: DEFAULT_BINDINGS as KeyBindings,
  labels: new KeyLabels(),
  enabled: false,
  pointer: false,
  slot: 0,
  releaseAll: () => {},
};
/** Columns never arrive: the world stays on its loading screen, which is enough here. */
const pool = { size: 1, run: () => new Promise(() => {}) };
/** Muted: no AudioContext under Node, the plays only logged. */
const audio = new AudioEngine([], { muted: true });

/** A Game over stand-ins (no WebGL, workers or sound) in a fake page, saving into `storage`. */
function setup(params: Partial<BootParams> = {}) {
  const win = installFakeWindow();
  const storage = new RecordingStorage();
  const failures: unknown[] = [];
  const pixelRatios: number[] = [];
  let loop: ((dt: number) => void) | null = null;
  const root = document.createElement('div');
  const host: GameHost = {
    root,
    // The free camera plays without click-to-play or the bag (no Pointer Lock under Node).
    params: { ...DEFAULT_BOOT_PARAMS, freecam: true, worldType: 'flat', rd: 2, ...params },
    registry,
    workers: pool as unknown as WorkerPool,
    view: createTestWorldView().view,
    input: input as unknown as InputManager,
    audio,
    layers: [],
    layoutLoaded: Promise.resolve(),
    frames: { span: () => {} } as unknown as FrameStats,
    touchOnly: false,
    xray: () => false,
    setPixelRatio: (cap) => pixelRatios.push(cap),
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
    pixelRatios,
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

/** A key pressed while playing or in the menus (the game listens on the window). */
function press(s: ReturnType<typeof setup>, code: string) {
  const event = { code, key: code, repeat: false, defaultPrevented: false, stopPropagation() {} };
  s.win.dispatch('keydown', event);
}

describe('settings', () => {
  beforeEach(() => installFakeDom());

  afterEach(() => {
    vi.unstubAllGlobals();
    removeFakeWindow();
    removeFakeDom();
  });

  it('applies the settings at once and again to each world it opens', async () => {
    const s = setup();
    expect(s.pixelRatios).toEqual([DEFAULT_SETTINGS.pixelRatio]);
    const bindings = { ...DEFAULT_BINDINGS, jump: ['KeyJ'] };
    s.game.changeSettings({
      ...DEFAULT_SETTINGS,
      pixelRatio: 0.75,
      particles: false,
      viewBob: false,
      crouch: 'toggle',
      bindings,
      uiScale: 1.25,
    });
    expect(s.pixelRatios.at(-1)).toBe(0.75);
    expect(input.bindings).toBe(bindings);
    expect(input.crouchToggle).toBe(true);
    expect(s.root.style.getPropertyValue('--ui-scale')).toBe('1.25');
    expect(s.root.style.getPropertyValue('--ui-unscale')).toBe('0.8');

    await s.game.createWorld({ name: 'Feel', seed: 'feel', hostiles: true });
    const session = s.game.open!.session;
    expect(session.play.particles.enabled).toBe(false);
    expect(session.rig.viewBob).toBe(false);
    s.game.changeSettings({ ...s.game.settings, particles: true, viewBob: true });
    expect(session.play.particles.enabled).toBe(true);
    expect(session.rig.viewBob).toBe(true);
    s.game.changeSettings(DEFAULT_SETTINGS);
    expect(input.crouchToggle).toBe(false);
  });

  it('takes the resolution and the particles of ?quality= over the settings', async () => {
    const s = setup({ quality: 'low' });
    s.game.changeSettings({ ...DEFAULT_SETTINGS, pixelRatio: 2, particles: true });
    expect(s.pixelRatios.at(-1)).toBe(1);
    await s.game.createWorld({ name: 'Low', seed: 'low', hostiles: true });
    expect(s.game.open!.session.play.particles.enabled).toBe(false);
  });

  it('pauses on the pause key as rebound, and goes back a menu with it', async () => {
    const s = setup();
    s.game.changeSettings({
      ...DEFAULT_SETTINGS,
      bindings: { ...DEFAULT_BINDINGS, pause: ['KeyP'] },
    });
    await s.game.createWorld({ name: 'Pause', seed: 'pause', hostiles: true });
    press(s, 'Escape');
    expect(s.game.state).not.toBe('paused');
    press(s, 'KeyP');
    expect(s.game.state).toBe('paused');
    s.button('settings').dispatch('click');
    expect(s.game.menus.screen()).toBe('settings');
    s.button('controls').dispatch('click');
    expect(s.game.menus.screen()).toBe('controls');
    press(s, 'KeyP');
    expect(s.game.menus.screen()).toBe('settings');
    s.game.changeSettings(DEFAULT_SETTINGS);
  });

  it('keeps a key rebound on Key bindings through the next change on Settings', () => {
    const s = setup();
    const menus = s.game.menus.element as unknown as FakeElement;
    s.button('settings').dispatch('click');
    s.button('controls').dispatch('click');
    const jump = menus.findAll((e) => e.getAttribute('data-bind') === 'jump:0')[0]!;
    jump.dispatch('click');
    press(s, 'KeyJ');
    expect(input.bindings.jump).toEqual(['KeyJ']);
    expect(s.game.settings.bindings.jump).toEqual(['KeyJ']);
    s.button('back').dispatch('click');
    expect(s.game.menus.screen()).toBe('settings');
    const box = menus.findAll((e) => e.getAttribute('name') === 'viewBob')[0]!;
    (box as FakeElement & { checked: boolean }).checked = false;
    box.dispatch('change');
    expect(s.game.settings).toMatchObject({ viewBob: false, bindings: { jump: ['KeyJ'] } });
    s.game.changeSettings(DEFAULT_SETTINGS);
  });

  it('reads the stored settings, but plays selftests and benchmarks on the defaults', () => {
    const stored = {
      ...DEFAULT_SETTINGS,
      fov: 95,
      bindings: { ...DEFAULT_BINDINGS, drop: ['KeyQ'] },
    };
    const text = writeSettings(stored);
    vi.stubGlobal('localStorage', { getItem: () => text, setItem: () => {} });
    expect(setup().game.settings).toEqual(stored);
    removeFakeWindow();
    expect(setup({ selftest: 'm11' }).game.settings).toBe(DEFAULT_SETTINGS);
    removeFakeWindow();
    expect(setup({ bench: 'walk' }).game.settings).toBe(DEFAULT_SETTINGS);
    expect(localStorage.getItem(SETTINGS_KEY)).toBe(text);
  });
});
