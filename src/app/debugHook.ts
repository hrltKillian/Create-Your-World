import { clampPitch } from '../core/angles.ts';
import { i18nMissing } from '../i18n/i18n.ts';
import type { Action } from '../input/bindings.ts';
import { rigDegrees } from '../render/rigs.ts';
import { DEBUG_VIEWS, type DebugView } from '../render/voxelMaterial.ts';
import type { CameraPose } from '../render/WorldView.ts';
import { Column } from '../world/Column.ts';
import { columnHash, generateColumn, pointInfo } from '../world/gen/generateColumn.ts';
import type { App } from './App.ts';
import { fill, nextFrame, teleport, waitForChunks, yieldTask } from './automation.ts';

/**
 * Dev-only automation API (`window.__game`). Loaded through a dynamic import guarded by
 * `__DEBUG_HOOK__`, so it never ships in production builds.
 */
export function installDebugHook(app: App): void {
  const api = {
    version: 3,
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
    input: {
      /** Sets the view angles (radians). */
      look: (yaw: number, pitch: number) => {
        if (!app.session) return;
        app.session.rig.yaw = yaw;
        app.session.rig.pitch = clampPitch(pitch);
      },
      /** Holds an action for `ticks` ticks; in fixed-step mode it also advances those ticks. */
      press: (action: Action, ticks = 1) => {
        if (!app.input || !app.session) return;
        app.input.force(action, ticks);
        if (app.params.fixedStep) app.session.step(ticks);
      },
      release: () => app.input?.releaseAll(),
      keyLabel: (action: Action) => app.input?.keyLabel(action) ?? null,
    },
    player: {
      get: () => {
        const p = app.session?.player;
        if (!p) return null;
        const b = p.body;
        return {
          x: b.x,
          y: b.y,
          z: b.z,
          vx: b.vx,
          vy: b.vy,
          vz: b.vz,
          onGround: b.onGround,
          inWater: b.inWater,
          crouching: b.crouching,
          stamina: p.stamina,
          exhausted: p.exhausted,
          yaw: p.yaw,
          pitch: p.pitch,
        };
      },
      teleport: (x: number, y: number | 'surface', z: number) => teleport(app, x, y, z),
      setStamina: (value: number) =>
        app.session?.host.send({ type: 'debug.setStat', stat: 'stamina', value }),
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
        const info = pointInfo(session.host.view.gen, Math.floor(x), Math.floor(z));
        return { biome: session.host.view.gen.biomes[info.biome]!.def.key, height: info.height };
      },
      /** Hash of a column generated on the main thread (compare with the Node golden tests). */
      genHash: (cx: number, cz: number) => {
        const session = app.session;
        if (!session || !app.registry) return null;
        const column = new Column(cx, cz, app.registry.air);
        generateColumn(session.host.view.gen, column);
        return columnHash(session.host.view.gen, column);
      },
      /**
       * Resolves once every column within `radius` of the camera is meshed. Returns the wait and the
       * time since the session started. While the page is hidden (no animation frames), it steps the
       * world itself so automation keeps working.
       */
      waitForChunks: async ({
        radius,
        timeout = 20_000,
      }: {
        radius?: number;
        timeout?: number;
      } = {}) => {
        const session = app.session;
        if (!session) throw new Error('No world session');
        const t0 = performance.now();
        await waitForChunks(app, radius ?? session.loadingRadius(), timeout);
        const now = performance.now();
        return { ms: now - t0, sinceStart: now - session.startedAt };
      },
      /** Steps the world for `ms` of wall time without rendering (useful when the pane is hidden). */
      pump: async (ms = 1000) => {
        const session = app.session;
        if (!session) return;
        const end = performance.now() + ms;
        while (performance.now() < end) {
          session.pumpOnce(document.hidden);
          await yieldTask();
        }
      },
      /** Fills a box (inclusive corners) with a block state key, e.g. the key `world.block` returns. */
      fill: (
        x0: number,
        y0: number,
        z0: number,
        x1: number,
        y1: number,
        z1: number,
        state: string,
      ) => fill(app, x0, y0, z0, x1, y1, z1, state),
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
      /** Animation angles (degrees) and head pivot height of an entity's rig. */
      rig: (who: 'player' | number = 'player') => {
        const session = app.session;
        if (!session) return null;
        const rig = session.entities.rig(who === 'player' ? session.player.id : who);
        return rig ? { angles: rigDegrees(rig), headPivotY: rig.headPivotY } : null;
      },
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
