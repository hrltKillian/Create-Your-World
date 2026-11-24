import { DEFAULT_QUALITY, QUALITY_PRESETS } from '../../render/quality.ts';
import type { App } from '../App.ts';
import { caveBenchmark } from '../bench/cave.ts';
import { digBenchmark } from '../bench/dig.ts';
import { flyBenchmark, walkBenchmark } from '../bench/motion.ts';
import { loadBenchmark } from '../benchmarks.ts';
import { applyQuality } from '../graphicsPreset.ts';
import {
  assert,
  assertTiming,
  needsGeneratedPlayer,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
} from './support.ts';

/**
 * M11 « Fait quand » performance checks (cave culling, benchmarks, quality presets), on the
 * generated world with real ticks: ?seed=7&rd=6&selftest=m0,<suite> (the free-camera `fly` case
 * with &freecam=1 instead). Deterministic counters (draws, triangles, sections) are hard checks;
 * frame-time thresholds are only checked on the bench build (`npm run bench`, pane visible: docs
 * « les mesures de perf se font uniquement sur bench »), and wall-clock ones not on slow CI
 * renderers (?timing=0). The integration step adds these cases to a suite (and its closing
 * `noErrorsCase`).
 */

/** « `cave` : ≤ 150 draws » and « −30 % de draws sous terre par rapport à occlusion=0 ». */
const MAX_CAVE_DRAWS = 150;
const MIN_CAVE_SAVED = 0.3;
/** « Draws à RD 6, surface ≤ 400 », « Triangles ≤ 1,5 M ». */
const MAX_DRAWS = 400;
const MAX_TRIANGLES = 1_500_000;
/** « Travail d'image p95, walk / fly ≤ 9 ms / ≤ 11 ms », « Intervalles > 20 ms en walk < 1 % ». */
const WALK_WORK_P95_MS = 9;
const FLY_WORK_P95_MS = 11;
const MAX_LONG_FRAMES = 0.01;
/** « Édition → maillage visible ≤ 50 ms p95 ». */
const EDIT_TO_MESH_P95_MS = 50;
/** « chargement (navigation → « Play » actif) ≤ 3 s ». */
const PLAYABLE_MS = 3000;
/** Shorter runs than the benchmarks' defaults: the selftest checks they work and their counters. */
const WALK_SECONDS = 6;
const FLY_SECONDS = 4;
const DIG_EDITS = 12;
/** A walk of WALK_SECONDS covers at least this many blocks (≈ 4.3 m/s on open ground). */
const MIN_WALKED = 6;

/** A frame-time threshold: on the bench build only (and not with ?timing=0). */
function onBench(app: App, condition: boolean, message: string): void {
  if (__BENCH__) assertTiming(app, condition, message);
}

const pct = (share: number) => `${(share * 100).toFixed(1)} %`;

function needsRealTicks(app: App): string | null {
  return (
    needsGeneratedPlayer(app) ?? (app.params.fixedStep ? 'needs real ticks (no ?fixedStep)' : null)
  );
}

function needsPlayer(app: App): string | null {
  return app.params.freecam ? 'needs a player (no ?freecam)' : null;
}

export const M11_PERF_CASES: readonly SelftestCase[] = [
  {
    name: `load: the world was playable within ${PLAYABLE_MS / 1000} s of the navigation (bench build)`,
    scenes: PLAY_SCENES,
    timeoutMs: 90_000,
    skip: needsPlayer,
    run: async (app) => {
      await playerSession(app);
      const load = await loadBenchmark(app);
      assert(load.playableMs > 0, 'no playable mark');
      onBench(
        app,
        load.playableMs <= PLAYABLE_MS,
        `playable after ${load.playableMs.toFixed(0)} ms`,
      );
    },
  },
  {
    name: `cave culling: from a cave pocket, ≤ ${MAX_CAVE_DRAWS} draws and ${pct(MIN_CAVE_SAVED)} fewer than with ?occlusion=0`,
    scenes: PLAY_SCENES,
    timeoutMs: 120_000,
    skip: needsGeneratedPlayer,
    run: async (app) => {
      await playerSession(app);
      const cave = await caveBenchmark(app, 2);
      const at = `at (${cave.pose.x}, ${cave.pose.y}, ${cave.pose.z})`;
      assert(cave.hidden > 0, `the culling hides no section ${at}`);
      assert(cave.draws <= MAX_CAVE_DRAWS, `${cave.draws} draws ${at} (> ${MAX_CAVE_DRAWS})`);
      assert(
        cave.saved >= MIN_CAVE_SAVED,
        `${cave.draws} draws ${at} with the culling, ${cave.drawsOff} without: ${pct(cave.saved)} saved`,
      );
      assert(
        app.view!.chunks.occlusion.isEnabled() === app.params.occlusion,
        'culling not restored',
      );
    },
  },
  {
    name: `benchmark('walk'): the player walks; ≤ ${MAX_DRAWS} draws, work p95 ≤ ${WALK_WORK_P95_MS} ms, < ${pct(MAX_LONG_FRAMES)} intervals over 20 ms (bench build)`,
    scenes: PLAY_SCENES,
    timeoutMs: 60_000,
    skip: needsRealTicks,
    run: async (app) => {
      await playerSession(app);
      const walk = await walkBenchmark(app, WALK_SECONDS);
      assert(walk.frames > 0 && walk.workP95 > 0, `no frame sampled: ${JSON.stringify(walk)}`);
      assert(walk.distance >= MIN_WALKED, `walked ${walk.distance.toFixed(1)} blocks`);
      assert(walk.draws <= MAX_DRAWS, `${walk.draws} draws (> ${MAX_DRAWS})`);
      assert(walk.triangles <= MAX_TRIANGLES, `${walk.triangles} triangles`);
      onBench(app, walk.workP95 <= WALK_WORK_P95_MS, `walk work p95 ${walk.workP95.toFixed(2)} ms`);
      onBench(app, walk.longFrames < MAX_LONG_FRAMES, `${pct(walk.longFrames)} intervals > 20 ms`);
    },
  },
  {
    name: `benchmark('dig'): repeated edits are written in place and shown within ${EDIT_TO_MESH_P95_MS} ms p95`,
    scenes: PLAY_SCENES,
    timeoutMs: 60_000,
    skip: needsPlayer,
    run: async (app) => {
      await playerSession(app);
      const dig = await digBenchmark(app, DIG_EDITS);
      assert(dig.edits === DIG_EDITS, `${dig.edits} edits timed of ${DIG_EDITS}`);
      assert(dig.inPlace > 0, 'no remesh was written into the vertex buffer already there');
      assertTiming(
        app,
        dig.editToMeshP95 <= EDIT_TO_MESH_P95_MS,
        `edit → mesh p95 ${dig.editToMeshP95.toFixed(1)} ms`,
      );
    },
  },
  {
    name: `benchmark('fly'): the free camera flies; work p95 ≤ ${FLY_WORK_P95_MS} ms (bench build)`,
    scenes: PLAY_SCENES,
    timeoutMs: 60_000,
    skip: (app) => (app.params.freecam ? null : 'needs ?freecam=1'),
    run: async (app) => {
      await app.ready();
      const fly = await flyBenchmark(app, FLY_SECONDS);
      assert(fly.frames > 0 && fly.workP95 > 0, `no frame sampled: ${JSON.stringify(fly)}`);
      onBench(app, fly.workP95 <= FLY_WORK_P95_MS, `fly work p95 ${fly.workP95.toFixed(2)} ms`);
    },
  },
  {
    name: 'render.setQuality: a preset sets the render distance and caps the pixel ratio',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const rd = session.renderDistance;
      const renderer = app.renderer!;
      try {
        const low = applyQuality(app, 'low');
        assert(session.renderDistance === QUALITY_PRESETS.low.renderDistance, 'render distance');
        assert(low.pixelRatio <= QUALITY_PRESETS.low.pixelRatio, `pixel ratio ${low.pixelRatio}`);
      } finally {
        renderer.setMaxPixelRatio(
          QUALITY_PRESETS[app.params.quality ?? DEFAULT_QUALITY].pixelRatio,
        );
        session.setRenderDistance(rd);
      }
    },
  },
];
