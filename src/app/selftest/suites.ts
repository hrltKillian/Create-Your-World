import { i18nMissing } from '../../i18n/i18n.ts';
import type { App } from '../App.ts';

export interface SelftestCase {
  readonly name: string;
  /** Only meaningful in these app states (others report the case as skipped). */
  readonly scenes?: readonly App['state'][];
  /** Overrides the runner's default per-case timeout (ms). */
  readonly timeoutMs?: number;
  /** Returns a reason to skip the case in this setup (for example "needs ?fixedStep=1"). */
  skip?(app: App): string | null;
  run(app: App): Promise<void> | void;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** In-browser acceptance checks, one suite per milestone. Earlier suites must stay green. */
export const SUITES: Readonly<Record<string, readonly SelftestCase[]>> = {
  m0: [
    { name: 'app is ready', run: (app) => app.ready() },
    {
      name: 'a scene is running',
      run: (app) => {
        assert(
          ['title', 'testchunk', 'loading', 'world'].includes(app.state),
          `state is ${app.state}`,
        );
        if (app.state === 'title')
          assert(document.querySelector('#screen-title .title')?.textContent, 'title text missing');
      },
    },
    {
      name: 'workers answer ping',
      run: async (app) => {
        assert(app.workers, 'no worker pool');
        assert((await app.workers.ping()) === 'pong', 'ping failed');
      },
    },
    {
      name: 'renderer draws with valid shaders',
      run: async (app) => {
        await nextFrame();
        const info = app.renderer?.webgl.info;
        assert(info, 'no renderer');
        assert(info.render.calls >= 1, `draw calls: ${info.render.calls}`);
        assert(info.render.triangles > 0, `triangles: ${info.render.triangles}`);
        const programs = (info.programs ?? []) as { diagnostics?: { runnable: boolean } }[];
        assert(programs.length > 0, 'no shader program');
        assert(
          programs.every((p) => p.diagnostics?.runnable !== false),
          'a shader program failed to compile or link',
        );
      },
    },
    {
      name: 'no errors and no missing strings',
      run: (app) => {
        assert(app.errors.length === 0, `errors: ${app.errors.join(' | ')}`);
        assert(i18nMissing().length === 0, `missing strings: ${i18nMissing().join(', ')}`);
      },
    },
  ],
  m1: [
    {
      name: 'test chunk scene is loaded from the content pack',
      scenes: ['testchunk'],
      run: async (app) => {
        await app.ready();
        assert(app.state === 'testchunk', `state is ${app.state} (open ?scene=testchunk)`);
        assert(app.registry && app.registry.tables.stateCount > 30, 'registry not built');
        const chunks = app.view?.chunks.stats();
        assert(chunks && chunks.meshes > 0 && chunks.quads > 0, 'no chunk meshes');
      },
    },
    {
      name: 'one draw call per non-empty pass when everything is in view',
      scenes: ['testchunk'],
      run: async (app) => {
        const cam = app.freecam!;
        const saved = { ...cam.pose };
        cam.set({ x: 16, y: 200, z: 16, yaw: 0, pitch: -Math.PI / 2 + 0.001 });
        await nextFrame();
        await nextFrame();
        const calls = app.renderer!.webgl.info.render.calls;
        const meshes = app.view!.chunks.stats().meshes;
        cam.set(saved);
        // + 1 for the sky dome.
        assert(calls === meshes + 1, `draw calls ${calls} ≠ non-empty passes ${meshes} + sky`);
      },
    },
    {
      name: 'the view is textured (more than 24 colours)',
      scenes: ['testchunk', 'world'],
      run: (app) => {
        const stats = app.view!.capture();
        assert(stats.uniqueColors > 24, `only ${stats.uniqueColors} colours`);
      },
    },
    {
      name: 'debug views change the picture and switch back',
      scenes: ['testchunk', 'world'],
      run: (app) => {
        const normal = app.view!.capture();
        app.setDebugView('quads');
        const quads = app.view!.capture();
        app.setDebugView('ao');
        const ao = app.view!.capture();
        app.setDebugView('none');
        assert(quads.avgLuma < normal.avgLuma, 'quad edges did not darken the view');
        assert(ao.uniqueColors < normal.uniqueColors, 'AO view is not greyscale');
      },
    },
    {
      name: 'no errors after the m1 checks',
      run: (app) => {
        assert(app.errors.length === 0, `errors: ${app.errors.join(' | ')}`);
        assert(i18nMissing().length === 0, `missing strings: ${i18nMissing().join(', ')}`);
      },
    },
  ],
  m2: [
    {
      name: 'the generated world streams around the camera (loading radius meshed)',
      scenes: ['loading', 'world'],
      timeoutMs: 30_000,
      run: async (app) => {
        await app.ready();
        const session = app.session;
        assert(session, 'no world session');
        const t0 = performance.now();
        while (!session.chunksReady(session.loadingRadius())) {
          assert(performance.now() - t0 < 25_000, 'loading radius not meshed after 25 s');
          await new Promise((r) => setTimeout(r, 50));
        }
        // The loading screen goes away on the next frame.
        await nextFrame();
        assert(app.state === 'world', `state is ${app.state}`);
        assert(app.view!.chunks.stats().meshes > 0, 'no chunk meshes');
      },
    },
    {
      name: 'workers and the main thread generate identical columns',
      scenes: ['world'],
      run: async (app) => {
        const { Column } = await import('../../world/Column.ts');
        const { columnHash, generateColumn } = await import('../../world/gen/generateColumn.ts');
        const session = app.session!;
        const streamed = [...session.sim.world.columns.values()].slice(0, 3);
        assert(streamed.length > 0, 'nothing streamed');
        for (const column of streamed) {
          const fresh = new Column(column.cx, column.cz, app.registry!.air);
          generateColumn(session.ctx, fresh);
          const a = columnHash(session.ctx, column);
          const b = columnHash(session.ctx, fresh);
          assert(a === b, `column ${column.cx},${column.cz}: worker ${a} ≠ main ${b}`);
        }
      },
    },
    {
      name: 'lowering the render distance frees geometry, raising it streams again',
      scenes: ['world'],
      timeoutMs: 100_000,
      run: async (app) => {
        const session = app.session!;
        const rd = session.renderDistance;
        const waitFor = async (what: string, done: () => boolean) => {
          const t0 = performance.now();
          while (!done()) {
            assert(performance.now() - t0 < 30_000, `${what} not reached after 30 s`);
            await new Promise((r) => setTimeout(r, 50));
            // Frames do not tick the simulation in fixed-step mode.
            if (app.params.fixedStep) session.step(1);
          }
        };
        await waitFor(`radius ${rd} meshed`, () => session.chunksReady(rd));
        const before = app.view!.chunks.stats().meshes;
        const smaller = Math.max(1, rd - 4);
        try {
          session.setRenderDistance(smaller);
          if (app.params.fixedStep) session.step(1);
          // Columns beyond RD' + 1 are hidden: their meshes are freed (data stays until RD' + 3.5).
          await waitFor('hiding', () => session.scheduler.idle() && session.chunksReady(smaller));
          for (let i = 0; i < 3; i++) await nextFrame();
          const after = app.view!.chunks.stats().meshes;
          assert(after < before, `meshes ${before} → ${after}`);
          // Only columns within RD' + 1 may keep meshes.
          const pose = session.focus();
          const ccx = Math.floor(Math.floor(pose.x) / 32);
          const ccz = Math.floor(Math.floor(pose.z) / 32);
          let allowed = 0;
          for (let dz = -smaller - 2; dz <= smaller + 2; dz++) {
            for (let dx = -smaller - 2; dx <= smaller + 2; dx++) {
              if (dx * dx + dz * dz <= (smaller + 1) * (smaller + 1))
                allowed += session.sim.world.getColumn(ccx + dx, ccz + dz) ? 8 : 0;
            }
          }
          assert(
            app.view!.chunks.stats().sections <= allowed,
            `sections ${app.view!.chunks.stats().sections} > ${allowed}`,
          );
        } finally {
          session.setRenderDistance(rd);
        }
        await waitFor('loading radius meshed again', () =>
          session.chunksReady(session.loadingRadius()),
        );
      },
    },
    {
      name: 'no errors after the m2 checks',
      run: (app) => {
        assert(app.errors.length === 0, `errors: ${app.errors.join(' | ')}`);
        assert(i18nMissing().length === 0, `missing strings: ${i18nMissing().join(', ')}`);
      },
    },
  ],
  m3: [
    {
      name: 'the player falls onto the flat surface',
      scenes: ['loading', 'world'],
      timeoutMs: 30_000,
      skip: needsFlatPlayer,
      run: async (app) => {
        const session = await playerSession(app);
        teleport(app, 0.5, 80, 0.5);
        session.step(120);
        const b = session.player.body;
        assert(Math.abs(b.y - 65) <= 0.01, `y = ${b.y}`);
        assert(b.onGround, 'not on the ground');
      },
    },
    {
      name: 'walking forward for 60 ticks covers 8.6 ± 0.9 m',
      scenes: ['world'],
      skip: needsFlatPlayer,
      run: async (app) => {
        const session = await playerSession(app);
        session.rig.yaw = 0;
        session.rig.pitch = 0;
        const b = session.player.body;
        const x0 = b.x;
        const z0 = b.z;
        app.input!.force('forward', 60);
        session.step(60);
        const d = Math.hypot(b.x - x0, b.z - z0);
        assert(Math.abs(d - 8.6) <= 0.9, `walked ${d.toFixed(2)} m`);
      },
    },
    {
      name: 'movement keys bind by physical position (AZERTY Z and QWERTY W)',
      scenes: ['world'],
      skip: needsFlatPlayer,
      run: async (app) => {
        const session = await playerSession(app);
        const b = session.player.body;
        for (const key of ['z', 'w']) {
          const x0 = b.x;
          const z0 = b.z;
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key }));
          session.step(20);
          window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key }));
          session.step(10);
          const d = Math.hypot(b.x - x0, b.z - z0);
          assert(d > 1, `key "${key}" moved ${d.toFixed(2)} m`);
        }
        assert(app.input!.keyLabel('forward').length > 0, 'no label for forward');
      },
    },
    {
      name: 'the avatar swings its limbs when walking, rests when idle and crouches',
      scenes: ['world'],
      skip: needsFlatPlayer,
      run: async (app) => {
        const session = await playerSession(app);
        const mode = session.rig.mode;
        session.rig.mode = 'third';
        try {
          const rig = () => session.entities.rig(session.player.id)!;
          // One tick per rendered frame for a wall-clock time, so the display rate does not matter.
          const play = async (ms: number) => {
            const t0 = performance.now();
            while (performance.now() - t0 < ms) {
              session.step(1);
              await nextFrame();
            }
          };
          app.input!.force('forward', 1e6);
          await play(600);
          app.input!.force('forward', 0);
          const swing = (rig().amplitude * 180) / Math.PI;
          assert(swing > 20, `walking swing ${swing.toFixed(1)}°`);
          await play(1000);
          const idle = (rig().amplitude * 180) / Math.PI;
          assert(idle < 2, `idle swing ${idle.toFixed(1)}°`);
          const standing = rig().headPivotY;
          app.input!.force('crouch', 1e6);
          await play(300);
          const crouched = rig().headPivotY;
          app.input!.force('crouch', 0);
          assert(crouched < standing - 0.2, `head pivot ${standing} → ${crouched}`);
          await play(300);
        } finally {
          session.rig.mode = mode;
        }
      },
    },
    {
      name: 'V toggles the view; the third-person camera stops in front of a wall',
      scenes: ['world'],
      skip: needsFlatPlayer,
      run: async (app) => {
        const session = await playerSession(app);
        const registry = app.registry!;
        teleport(app, 0.5, 65, 0);
        session.step(5);
        session.rig.yaw = 0;
        session.rig.pitch = 0;
        const mode = session.rig.mode;
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v' }));
        await nextFrame();
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyV', key: 'v' }));
        assert(session.rig.mode !== mode, `mode stayed ${mode}`);
        session.rig.mode = 'third';
        // The camera eases out per frame: wait wall-clock time, not a frame count.
        const settle = async () => {
          const t0 = performance.now();
          while (performance.now() - t0 < 700) await nextFrame();
        };
        await settle();
        assert(session.rig.distance > 3, `open-field distance ${session.rig.distance.toFixed(2)}`);
        const ground = registry.states[session.sim.world.getBlock(0, 64, 0)]!.key;
        const air = registry.states[registry.air]!.key;
        // A wall 2 m behind the player (the camera looks along −z, so behind is +z).
        session.host.send({
          type: 'debug.fill',
          x0: -2,
          y0: 65,
          z0: 2,
          x1: 2,
          y1: 68,
          z1: 2,
          state: ground,
        });
        session.step(1);
        try {
          await settle();
          assert(session.rig.distance < 2, `camera distance ${session.rig.distance.toFixed(2)}`);
        } finally {
          session.host.send({
            type: 'debug.fill',
            x0: -2,
            y0: 65,
            z0: 2,
            x1: 2,
            y1: 68,
            z1: 2,
            state: air,
          });
          session.step(1);
          session.rig.mode = mode;
        }
      },
    },
    {
      name: 'a far teleport loads the new area (radius 3 meshed in < 3 s)',
      scenes: ['world'],
      timeoutMs: 40_000,
      skip: needsFlatPlayer,
      run: async (app) => {
        const session = await playerSession(app);
        const t0 = performance.now();
        teleport(app, 4000.5, 'surface', 0.5);
        await nextFrame();
        assert(session.loading, 'the loading overlay did not come back');
        await waitForChunks(app, 3, 10_000);
        const ms = performance.now() - t0;
        assert(session.playerColumnLit(), 'player column not lit');
        assert(ms < 3000, `radius 3 meshed after ${ms.toFixed(0)} ms`);
        teleport(app, 0.5, 65, 0.5);
        await waitForChunks(app, 3, 20_000);
      },
    },
    {
      name: 'no errors after the m3 checks',
      run: (app) => {
        assert(app.errors.length === 0, `errors: ${app.errors.join(' | ')}`);
        assert(i18nMissing().length === 0, `missing strings: ${i18nMissing().join(', ')}`);
      },
    },
  ],
};

/** The m3 movement checks need a player (no free camera), fixed steps and the flat world. */
function needsFlatPlayer(app: App): string | null {
  if (app.params.freecam) return 'needs a player (no ?freecam)';
  if (!app.params.fixedStep) return 'needs ?fixedStep=1';
  if (app.params.worldType !== 'flat') return 'needs ?worldType=flat';
  return null;
}

async function playerSession(app: App) {
  await app.ready();
  const session = app.session;
  assert(session && app.input, 'no player session');
  await waitForChunks(app, session.loadingRadius(), 25_000);
  return session;
}

function teleport(app: App, x: number, y: number | 'surface', z: number): void {
  const session = app.session!;
  session.host.send({ type: 'debug.teleport', x, y, z });
  session.step(1);
}

/** Waits until `radius` is meshed around the player, stepping the world if frames stall. */
async function waitForChunks(app: App, radius: number, timeoutMs: number): Promise<void> {
  const session = app.session!;
  const t0 = performance.now();
  while (!session.chunksReady(radius)) {
    assert(performance.now() - t0 < timeoutMs, `radius ${radius} not meshed after ${timeoutMs} ms`);
    const frames = app.frames.frameTotal();
    await new Promise((r) => setTimeout(r, 16));
    if (app.frames.frameTotal() === frames) session.pumpOnce();
  }
  await nextFrame();
}
