import { i18nMissing } from '../../i18n/i18n.ts';
import type { App } from '../App.ts';

export interface SelftestCase {
  readonly name: string;
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
        assert(app.state === 'title' || app.state === 'testchunk', `state is ${app.state}`);
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
      run: async (app) => {
        const cam = app.freecam!;
        const saved = { ...cam.pose };
        cam.set({ x: 16, y: 200, z: 16, yaw: 0, pitch: -Math.PI / 2 + 0.001 });
        await nextFrame();
        await nextFrame();
        const calls = app.renderer!.webgl.info.render.calls;
        const meshes = app.view!.chunks.stats().meshes;
        cam.set(saved);
        assert(calls === meshes, `draw calls ${calls} ≠ non-empty passes ${meshes}`);
      },
    },
    {
      name: 'the view is textured (more than 24 colours)',
      run: (app) => {
        const stats = app.view!.capture();
        assert(stats.uniqueColors > 24, `only ${stats.uniqueColors} colours`);
      },
    },
    {
      name: 'debug views change the picture and switch back',
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
};
