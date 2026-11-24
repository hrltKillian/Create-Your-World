import type { Quality } from '../../render/quality.ts';
import { rigDegrees } from '../../render/rigs.ts';
import { DEBUG_VIEWS, type DebugView } from '../../render/voxelMaterial.ts';
import type { App } from '../App.ts';
import { nextFrame } from '../automation.ts';
import { BENCH_KINDS, type BenchKind, runBenchmark } from '../benchmarks.ts';
import { applyQuality } from '../graphicsPreset.ts';

/** `__game.perf`: frame statistics, the worker pool, the mesh scheduler and the benchmarks. */
export function perfHook(app: App) {
  return {
    fps: () => app.frames.fps(),
    snapshot: () => ({ ...app.frames.snapshot(), spans: app.frames.spanP95() }),
    pool: () => app.workers?.stats() ?? null,
    mesh: () => app.session?.scheduler.stats() ?? null,
    /** Time (ms) from the first edit of the last mesh batch to the swap of its meshes. */
    editToMeshMs: () => app.session?.scheduler.editToMeshMs ?? null,
    /** Share of the nominal client mesh slices in use (the adaptive throttle, 0.25–1). */
    throttle: () => app.session?.throttle.scale ?? null,
    /**
     * Runs a benchmark (`benchmarks.ts`): `walk`, `fly` (?freecam=1), `cave`, `mobs`, `dig` (the
     * number of edits instead of seconds) or `load`, on the bench build with the pane visible.
     */
    benchmark: (kind: BenchKind = 'fly', seconds?: number) => {
      if (!BENCH_KINDS.includes(kind))
        throw new Error(`Unknown benchmark "${kind}" (${BENCH_KINDS.join(', ')})`);
      return runBenchmark(app, kind, seconds);
    },
  };
}

/** `__game.render`: renderer counters, the chunk meshes and their culling, rigs, aim, views. */
export function renderHook(app: App) {
  return {
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
    /** Sections, meshes, quads, geometry bytes, remeshes written in place, sections culled. */
    chunks: () => app.view?.chunks.stats() ?? null,
    /**
     * The cave culling: turned on or off when `enabled` is given (like `?occlusion=0`), then its
     * state: enabled, walks so far, sections the last walk reached and its time (ms), and the
     * meshed sections it hides.
     */
    occlusion: (enabled?: boolean) => {
      const chunks = app.view?.chunks;
      if (!chunks) return null;
      if (enabled !== undefined) chunks.occlusion.setEnabled(enabled);
      return { ...chunks.occlusion.stats(), hidden: chunks.stats().hidden };
    },
    /** A graphics preset now ('low', 'medium', 'high'): pixel-ratio cap and render distance. */
    setQuality: (quality: Quality) => applyQuality(app, quality),
    /** Animation angles (degrees) and head pivot height of an entity's rig. */
    rig: (who: 'player' | number = 'player') => {
      const session = app.session;
      if (!session) return null;
      const rig = session.entities.rig(who === 'player' ? session.player.id : who);
      return rig
        ? { angles: rigDegrees(rig), headPivotY: rig.headPivotY, strike: rig.strike }
        : null;
    },
    /** The block under the crosshair (null: none) and the placement ghost (null: none). */
    target: () => {
      const aim = app.session?.aim;
      if (!aim) return null;
      const { hit, ghost } = aim;
      return {
        block: hit.hit
          ? { x: hit.x, y: hit.y, z: hit.z, nx: hit.nx, ny: hit.ny, nz: hit.nz }
          : null,
        ghost: ghost.state >= 0 ? { x: ghost.x, y: ghost.y, z: ghost.z } : null,
      };
    },
    /** Crack stage shown on the mined block (−1: none). */
    crack: () => app.session?.play.overlay.crackStage ?? -1,
    /** First-person hand view: drawn this frame, stroke progress (0 at rest), boxes. */
    hand: () => {
      const hand = app.session?.play.hand;
      return hand ? { visible: hand.visible, swing: hand.swing, boxes: hand.batch.size } : null;
    },
    /** Boxes in the world batch this frame and live break particles. */
    boxes: () => {
      const play = app.session?.play;
      return play ? { boxes: play.batch.size, particles: play.particles.alive() } : null;
    },
    /** Sections whose mesh on screen is older than their data (0 once edits are visible). */
    sectionVersionLag: () => app.session?.scheduler.sectionVersionLag() ?? null,
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
  };
}
