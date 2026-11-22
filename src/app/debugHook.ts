import { i18nMissing } from '../i18n/i18n.ts';
import { DEBUG_VIEWS, type DebugView } from '../render/voxelMaterial.ts';
import type { CameraPose } from '../render/WorldView.ts';
import { Column } from '../world/Column.ts';
import { columnHash, generateColumn, pointInfo } from '../world/gen/generateColumn.ts';
import type { App } from './App.ts';

/**
 * Dev-only automation API (`window.__game`). Loaded through a dynamic import guarded by
 * `__DEBUG_HOOK__`, so it never ships in production builds.
 */
export function installDebugHook(app: App): void {
  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const api = {
    version: 2,
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
      snapshot: () => ({ ...app.frames.snapshot(), spans: app.frames.spanP95() }),
      pool: () => app.workers?.stats() ?? null,
      mesh: () => app.session?.scheduler.stats() ?? null,
      /**
       * Flies the camera in a straight line for `seconds` (pane must be visible) and returns frame
       * statistics: CPU work p95, share of intervals over 20 ms, subsystem p95.
       */
      benchmark: async (kind: 'fly' = 'fly', seconds = 10) => {
        const cam = app.freecam;
        if (!cam) throw new Error('No camera');
        const start = { ...cam.pose };
        cam.set({ y: Math.max(start.y, 110), pitch: -0.2, yaw: -Math.PI / 2 });
        const t0 = performance.now();
        await new Promise<void>((resolve) => {
          const tick = () => {
            const t = (performance.now() - t0) / 1000;
            cam.set({ x: start.x + t * 20 });
            if (t >= seconds) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        return { kind, seconds, ...app.frames.snapshot(), spans: app.frames.spanP95() };
      },
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
      seed: () => app.session?.seed ?? null,
      spawn: () => app.session?.spawn ?? null,
      /** Biome key and surface height at a block column (analytic, no generation needed). */
      biome: (x: number, z: number) => {
        const session = app.session;
        if (!session) return null;
        const info = pointInfo(session.ctx, Math.floor(x), Math.floor(z));
        return { biome: session.ctx.biomes[info.biome]!.def.key, height: info.height };
      },
      /** Hash of a column generated on the main thread (compare with the Node golden tests). */
      genHash: (cx: number, cz: number) => {
        const session = app.session;
        if (!session || !app.registry) return null;
        const column = new Column(cx, cz, app.registry.air);
        generateColumn(session.ctx, column);
        return columnHash(session.ctx, column);
      },
      /** Resolves once every column within `radius` of the camera is meshed; returns the time it took. */
      waitForChunks: async ({
        radius = 3,
        timeout = 20_000,
      }: {
        radius?: number;
        timeout?: number;
      } = {}) => {
        const session = app.session;
        if (!session) throw new Error('No world session');
        const t0 = performance.now();
        while (!session.chunksReady(radius)) {
          if (performance.now() - t0 > timeout)
            throw new Error(`chunks not ready after ${timeout} ms`);
          await new Promise((r) => setTimeout(r, 16));
        }
        return { ms: performance.now() - t0 };
      },
      /** Steps the world for `ms` of wall time without rendering (useful when the pane is hidden). */
      pump: async (ms = 1000) => {
        const session = app.session;
        if (!session) return;
        const end = performance.now() + ms;
        while (performance.now() < end) {
          session.pumpOnce();
          await new Promise((r) => setTimeout(r, 0));
        }
      },
      setRenderDistance: (rd: number) => app.session?.setRenderDistance(rd),
      memory: () => ({
        voxelBytes: app.world?.voxelBytes() ?? 0,
        geometries: app.renderer?.webgl.info.memory.geometries ?? 0,
        geometryBytes: app.view?.chunks.stats().geometryBytes ?? 0,
      }),
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
