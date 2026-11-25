import type { Action } from '../input/bindings.ts';
import type { CameraPose } from '../render/WorldView.ts';
import type { App } from './App.ts';
import { ambienceView, audioMark, heardSince } from './audioAutomation.ts';
import { clock, freezeTime, look, press, setTime } from './automation.ts';
import { botHook, craftHooks, entitiesHook, playerHook, questsHook } from './hook/player.ts';
import { perfHook, renderHook } from './hook/render.ts';
import { onboardingHook, saveHook, settingsHook, uiHook } from './hook/screens.ts';
import { worldHook } from './hook/world.ts';

/**
 * Dev-only automation API (`window.__game`). Loaded through a dynamic import guarded by
 * `__DEBUG_HOOK__`, so it never ships in production builds. The larger groups are in `hook/`:
 * player, entities, craft, container, quests and bot (`player.ts`), world (`world.ts`), render
 * and perf (`render.ts`), ui, settings, save and onboarding (`screens.ts`).
 */
export function installDebugHook(app: App): void {
  const api = {
    version: 22,
    params: app.params,
    ready: () => app.ready(),
    errors: () => [...app.errors],
    state: () => app.state,
    capabilities: () => app.capabilities,
    selftest: async (selection = 'all') => {
      const { runSelftests } = await import('./selftest/runner.ts');
      return runSelftests(app, selection);
    },
    workers: {
      size: () => app.workers?.size ?? 0,
      ping: async () => {
        if (!app.workers) throw new Error('Workers are not running');
        return app.workers.ping();
      },
    },
    perf: perfHook(app),
    camera: {
      get: (): CameraPose | null =>
        app.freecam ? { ...app.freecam.pose } : app.session ? { ...app.session.rig.pose } : null,
      set: (pose: Partial<CameraPose>) => app.freecam?.set(pose),
      /** Mode ('first' | 'third') and current third-person distance. */
      mode: () =>
        app.session ? { mode: app.session.rig.mode, distance: app.session.rig.distance } : null,
      toggle: () => app.session?.rig.toggleMode(),
    },
    sim: {
      /** Advances n ticks now (use with ?fixedStep=1). */
      step: (n = 1) => app.session?.step(n),
      tick: () => app.session?.host.view.tick() ?? 0,
      hash: () => app.session?.host.view.hash() ?? null,
    },
    time: {
      /** The world clock: ticks, hour (0–24), day number, phase, daylight and the freeze flag. */
      get: () => clock(app),
      /** Moves the clock to an hour (0 ≤ hours < 24) of the current day, now; returns the clock. */
      set: (hours: number) => {
        setTime(app, hours);
        return clock(app);
      },
      /** Stops (or, with false, restarts) the clock, now; returns the clock. */
      freeze: (frozen = true) => {
        freezeTime(app, frozen);
        return clock(app);
      },
    },
    input: {
      /** Sets the view angles (radians). */
      look: (yaw: number, pitch: number) => look(app, yaw, pitch),
      /** Holds an action for `ticks` ticks; in fixed-step mode it also advances those ticks. */
      press: (action: Action, ticks = 1) => press(app, action, ticks),
      release: () => app.input?.releaseAll(),
      keyLabel: (action: Action) => app.input?.keyLabel(action) ?? null,
    },
    player: playerHook(app),
    entities: entitiesHook(app),
    ...craftHooks(app),
    quests: questsHook(app),
    bot: botHook(app),
    world: worldHook(app),
    render: renderHook(app),
    ui: uiHook(app),
    settings: settingsHook(app),
    save: saveHook(app),
    onboarding: onboardingHook(app),
    audio: {
      /** Keys of the sounds played (oldest first), logged even when muted or not yet resumed. */
      log: () => app.audio?.log() ?? [],
      state: () => app.audio?.state() ?? null,
      /** A mark in the log (every key ever logged), for `since`. */
      mark: () => audioMark(app),
      /** The keys logged after a mark, oldest first (within the log's last 256). */
      since: (mark: number) => heardSince(app, mark),
      /** The ambience: its loops and gains, the underwater low-pass, the place heard. */
      ambience: () => ambienceView(app),
    },
  };
  window.__game = api;
}
