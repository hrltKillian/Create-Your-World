import { i18nMissing } from '../../i18n/i18n.ts';
import type { App } from '../App.ts';

export interface SelftestCase {
  readonly name: string;
  /** Only meaningful in these app states (others report the case as skipped). */
  readonly scenes?: readonly App['state'][];
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
      name: 'the generated world streams around the camera (radius 3 meshed)',
      scenes: ['loading', 'world'],
      run: async (app) => {
        await app.ready();
        const session = app.session;
        assert(session, 'no world session');
        const t0 = performance.now();
        while (!session.chunksReady(3)) {
          assert(performance.now() - t0 < 20_000, 'radius 3 not meshed after 20 s');
          await new Promise((r) => setTimeout(r, 50));
        }
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
      run: async (app) => {
        const session = app.session!;
        const rd = session.renderDistance;
        const waitFor = async (what: string, done: () => boolean) => {
          const t0 = performance.now();
          while (!done()) {
            assert(performance.now() - t0 < 30_000, `${what} not reached after 30 s`);
            await new Promise((r) => setTimeout(r, 50));
          }
        };
        await waitFor(`radius ${rd} meshed`, () => session.chunksReady(rd));
        const before = app.view!.chunks.stats().meshes;
        const columnsBefore = session.sim.world.columns.size;
        // The new unload radius (RD' + 3.5) must be inside the old generation radius (RD + 2.5).
        const smaller = Math.max(1, rd - 4);
        const unload = smaller + 3.5;
        session.setRenderDistance(smaller);
        let keep = 0;
        for (let dz = -12; dz <= 12; dz++) {
          for (let dx = -12; dx <= 12; dx++) if (dx * dx + dz * dz <= unload * unload) keep++;
        }
        await waitFor('unloading', () => session.sim.world.columns.size <= keep);
        const after = app.view!.chunks.stats().meshes;
        const columnsAfter = session.sim.world.columns.size;
        session.setRenderDistance(rd);
        assert(columnsAfter < columnsBefore, `columns ${columnsBefore} → ${columnsAfter}`);
        // Meshed columns sit within RD; they only unload (with their meshes) when RD' + 3.5 < RD.
        if (unload < rd) assert(after < before, `meshes ${before} → ${after}`);
        await waitFor('radius 3 meshed again', () => session.chunksReady(3));
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
};
