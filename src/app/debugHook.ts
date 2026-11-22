import { i18nMissing } from '../i18n/i18n.ts';
import { DEBUG_VIEWS, type DebugView } from '../render/voxelMaterial.ts';
import type { CameraPose } from '../render/WorldView.ts';
import type { App } from './App.ts';

/**
 * Dev-only automation API (`window.__game`). Loaded through a dynamic import guarded by
 * `__DEBUG_HOOK__`, so it never ships in production builds.
 */
export function installDebugHook(app: App): void {
  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const api = {
    version: 1,
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
    perf: {
      fps: () => app.frames.fps(),
      snapshot: () => app.frames.snapshot(),
    },
    camera: {
      get: (): CameraPose | null => (app.freecam ? { ...app.freecam.pose } : null),
      set: (pose: Partial<CameraPose>) => app.freecam?.set(pose),
    },
    world: {
      /** Text key of the block state at a position (or null outside the loaded world). */
      block: (x: number, y: number, z: number) => {
        if (!app.world || !app.registry) return null;
        return app.registry.states[app.world.getBlock(x, y, z)]?.key ?? null;
      },
      voxelBytes: () => app.world?.voxelBytes() ?? 0,
      stateCount: () => app.registry?.tables.stateCount ?? 0,
    },
    render: {
      info: () => {
        const info = app.renderer?.webgl.info;
        return info
          ? {
              calls: info.render.calls,
              triangles: info.render.triangles,
              geometries: info.memory.geometries,
              textures: info.memory.textures,
              programs: info.programs?.length ?? 0,
            }
          : null;
      },
      chunks: () => app.view?.chunks.stats() ?? null,
      debugView: (view?: DebugView) => {
        if (view !== undefined) {
          if (!DEBUG_VIEWS.includes(view))
            throw new Error(`Unknown view "${view}" (${DEBUG_VIEWS.join(', ')})`);
          app.setDebugView(view);
        }
        return app.debugView;
      },
      /** Renders the current view off-screen and returns colour statistics. */
      capture: () => app.view?.capture() ?? null,
      nextFrame,
    },
    ui: {
      i18nMissing,
      text: (selector: string) => document.querySelector(selector)?.textContent ?? null,
      toggleDebug: () => app.overlay?.toggle(),
    },
  };
  window.__game = api;
}
