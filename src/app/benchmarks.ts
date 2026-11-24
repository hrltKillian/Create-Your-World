import { ticksOf } from '../sim/clock.ts';
import type { App } from './App.ts';
import { waitUntil, yieldTask } from './automation.ts';
import { caveBenchmark } from './bench/cave.ts';
import { digBenchmark } from './bench/dig.ts';
import { flyBenchmark, walkBenchmark } from './bench/motion.ts';
import { staged } from './bench/stage.ts';
import { killCreature, placeCreature } from './creatureAutomation.ts';
import { percentile } from './perf.ts';
import { setStat } from './survivalAutomation.ts';

/**
 * The performance benchmarks of `__game.perf.benchmark(kind)` and `?bench=` (docs « Mesure de
 * performance », M11 « Fait quand »), measured on the bench build (`npm run bench`, pane visible):
 * - `walk`: the player walking on the generated world (frame work p95, intervals over 20 ms);
 * - `fly`: the free camera flown in a straight line (the same);
 * - `cave`: a fixed pose deep underground, the cave culling on then off (draws);
 * - `mobs`: about 25 creatures around the player (simulation ticks);
 * - `dig`: repeated edits beside the player (edit → mesh p95);
 * - `load`: navigation → world playable, and → render distance meshed.
 * The frame benchmarks are in `bench/`.
 */
export const BENCH_KINDS = ['walk', 'fly', 'cave', 'mobs', 'dig', 'load'] as const;
export type BenchKind = (typeof BENCH_KINDS)[number];

/**
 * Runs a benchmark: `seconds` of frames or ticks (`dig`: the number of edits; `load` takes none);
 * each kind has its own default.
 */
export function runBenchmark(app: App, kind: BenchKind, seconds?: number) {
  switch (kind) {
    case 'walk':
      return walkBenchmark(app, seconds);
    case 'fly':
      return flyBenchmark(app, seconds);
    case 'cave':
      return caveBenchmark(app, seconds);
    case 'mobs':
      return mobsBenchmark(app, seconds);
    case 'dig':
      return digBenchmark(app, seconds);
    case 'load':
      return loadBenchmark(app);
    default:
      throw new Error(`Unknown benchmark "${String(kind)}" (${BENCH_KINDS.join(', ')})`);
  }
}

/**
 * Load times since the navigation started (ms; `performance.now()` counts from it): to the
 * world's first playable frame (loading radius meshed, `App.playableAt`), and to the whole render
 * distance meshed (as first seen by this call: run it at boot, `?bench=load`).
 */
export async function loadBenchmark(app: App) {
  const session = app.session;
  if (!session) throw new Error('No world session');
  await waitUntil(() => app.playableAt >= 0, {
    timeoutMs: 60_000,
    label: 'the world never became playable',
    pollMs: 20,
  });
  await waitUntil(() => session.chunksReady(session.renderDistance), {
    timeoutMs: 60_000,
    label: `render distance ${session.renderDistance} not meshed`,
    pollMs: 20,
  });
  return {
    kind: 'load' as const,
    playableMs: app.playableAt,
    renderDistanceMs: performance.now(),
    loadingRadius: session.loadingRadius(),
    renderDistance: session.renderDistance,
  };
}

/** The `mobs` scene: « environ 25 créatures », hunting by night. */
export const MOBS = {
  creatures: 25,
  /** Seconds of ticks measured by default. */
  seconds: 10,
  /** Hour of the world clock (frozen) while it runs: the hostiles hunt. */
  hour: 23,
  /** Ticks run before the measured ones (the creatures settle, find their target, plan). */
  warmupTicks: 60,
  /** Rings 8 to 28 blocks around the player. */
  ringMin: 8,
  ringStep: 4,
  rings: 6,
  /** Ticks between two yields to the page (it stays responsive). */
  batchTicks: 30,
} as const;

/** Golden angle (radians): creatures spread evenly around the player. */
const GOLDEN_ANGLE = 2.399;

/**
 * Places MOBS.creatures creatures of every kind of the pack (in turn) on the ground around the
 * player, freezes the clock at night and makes the player immune, runs `seconds` of ticks after a
 * warm-up and returns the simulation tick's wall time alone (`GameSession.tickMs`): median, p95
 * and max. The clock, the player's immunity and toxicity (Swarmling bites) and the world are put
 * back after (the creatures still there are killed, so their loot stays on the ground).
 */
export async function mobsBenchmark(app: App, seconds: number = MOBS.seconds) {
  const session = app.session;
  const kinds = app.registry?.pack.creatures ?? [];
  if (!session) throw new Error('No world session');
  if (kinds.length === 0) throw new Error('The content pack has no creatures');
  const { toxicity } = session.player.survival;
  const ids: number[] = [];
  const ticks: number[] = [];
  await staged(app, MOBS.hour, async () => {
    try {
      const { x, z } = session.player.body;
      for (let n = 0; n < MOBS.creatures; n++) {
        const r = MOBS.ringMin + (n % MOBS.rings) * MOBS.ringStep;
        const angle = n * GOLDEN_ANGLE;
        const creature = kinds[n % kinds.length]!.key;
        const id = placeCreature(
          app,
          creature,
          x + Math.cos(angle) * r,
          'surface',
          z + Math.sin(angle) * r,
        );
        if (id === null)
          throw new Error(`${creature} could not be placed (unloaded or debugging off)`);
        ids.push(id);
      }
      const measured = ticksOf(seconds);
      for (let i = 0; i < MOBS.warmupTicks + measured; i++) {
        session.step(1);
        if (i >= MOBS.warmupTicks) ticks.push(session.tickMs);
        if (i % MOBS.batchTicks === MOBS.batchTicks - 1) await yieldTask();
      }
    } finally {
      for (const id of ids) killCreature(app, id);
      setStat(app, 'toxicity', toxicity);
    }
  });
  ticks.sort((a, b) => a - b);
  return {
    kind: 'mobs',
    creatures: ids.length,
    ticks: ticks.length,
    tickMedian: percentile(ticks, 0.5),
    tickP95: percentile(ticks, 0.95),
    tickMax: ticks.at(-1) ?? 0,
  };
}
