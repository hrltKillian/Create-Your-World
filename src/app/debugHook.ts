import { i18nMissing } from '../i18n/i18n.ts';
import type { App } from './App.ts';

/**
 * Dev-only automation API (`window.__game`). Loaded through a dynamic import guarded by
 * `__DEBUG_HOOK__`, so it never ships in production builds.
 */
export function installDebugHook(app: App): void {
  const api = {
    version: 0,
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
    },
    ui: {
      i18nMissing,
      text: (selector: string) => document.querySelector(selector)?.textContent ?? null,
    },
  };
  window.__game = api;
}
