import { ticksOf } from '../sim/clock.ts';
import type { App } from './App.ts';
import { clock, freezeTime, setTime, yieldTask } from './automation.ts';
import { killCreature, placeCreature } from './creatureAutomation.ts';
import { percentile } from './perf.ts';
import { god, setStat } from './survivalAutomation.ts';

/**
 * The performance benchmarks of `__game.perf.benchmark(kind)` (docs « Mesure de performance »):
 * `fly`, the camera flown in a straight line (frame work), and `mobs`, about 25 creatures around
 * the player (simulation ticks).
 */

/**
 * Flies the free camera in a straight line for `seconds` (the pane must be visible) and returns
 * frame statistics: CPU work p95, share of intervals over 20 ms, subsystem p95.
 */
export async function flyBenchmark(app: App, seconds: number) {
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
  return { kind: 'fly', seconds, ...app.frames.snapshot(), spans: app.frames.spanP95() };
}

/** The `mobs` scene: « environ 25 créatures », hunting by night. */
export const MOBS = {
  creatures: 25,
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
export async function mobsBenchmark(app: App, seconds: number) {
  const session = app.session;
  const kinds = app.registry?.pack.creatures ?? [];
  const time = clock(app);
  if (!session || !time) throw new Error('No world session');
  if (kinds.length === 0) throw new Error('The content pack has no creatures');
  const { god: immune, toxicity } = session.player.survival;
  const ids: number[] = [];
  const ticks: number[] = [];
  try {
    setTime(app, MOBS.hour);
    freezeTime(app, true);
    god(app, true);
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
    god(app, immune);
    setStat(app, 'toxicity', toxicity);
    setTime(app, time.hour);
    freezeTime(app, time.frozen);
  }
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
