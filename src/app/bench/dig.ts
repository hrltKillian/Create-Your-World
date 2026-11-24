import type { App } from '../App.ts';
import { blockKey, setBlock, waitUntil, withinFrames } from '../automation.ts';
import { percentile } from '../perf.ts';

/**
 * The `dig` benchmark (docs « Édition → maillage visible ≤ 50 ms p95 »): one block beside the
 * player dug out and put back, again and again, each edit timed from the simulation's change to
 * the swap of its meshes (`MeshScheduler.editToMeshMs`).
 */

export const DIG = {
  /** Edits (an even count: the block ends as it was). */
  edits: 30,
  /** The edited cell: this many blocks east of the player, at the level under its feet. */
  offset: 2,
  /** Frames an edit may take to be applied (the next tick), then to be on screen. */
  maxFrames: 60,
  /** Longest wait for the meshing around the player to settle first. */
  settleMs: 30_000,
} as const;

/**
 * Digs and refills the cell beside the player `edits` times (the meshing around settled first;
 * a cell of air is filled with the ground under the player, then emptied). Edit → mesh p50, p95
 * and max (ms), and the remeshes written in place into the vertex buffers already there.
 */
export async function digBenchmark(app: App, edits: number = DIG.edits) {
  const session = app.session;
  const chunks = app.view?.chunks;
  if (!session || !chunks || !app.registry) throw new Error('No world session');
  const scheduler = session.scheduler;
  const focus = session.focus();
  const x = Math.floor(focus.x) + DIG.offset;
  const y = Math.floor(focus.y) - 1;
  const z = Math.floor(focus.z);
  const original = blockKey(app, x, y, z);
  const ground = blockKey(app, Math.floor(focus.x), y, z);
  const air = app.registry.states[app.registry.air]!.key;
  if (!original || !ground) throw new Error(`the cell (${x}, ${y}, ${z}) is not loaded`);
  // A solid cell is dug out; a cell of air is filled with the ground under the player.
  const other = original === air ? ground : air;
  if (other === original)
    throw new Error(`no ground under the player to fill (${x}, ${y}, ${z}) with`);
  await waitUntil(() => scheduler.idle(), {
    timeoutMs: DIG.settleMs,
    label: 'meshing still busy',
    pollMs: 50,
  });
  const inPlace = chunks.stats().inPlace;
  const times: number[] = [];
  try {
    for (let i = 0; i < edits + (edits % 2); i++) {
      const state = i % 2 === 0 ? other : original;
      setBlock(app, x, y, z, state);
      await frames(() => blockKey(app, x, y, z) === state, `edit ${i} not applied`);
      await frames(() => scheduler.sectionVersionLag() === 0, `edit ${i} not on screen`);
      times.push(scheduler.editToMeshMs);
    }
  } finally {
    setBlock(app, x, y, z, original);
  }
  times.sort((a, b) => a - b);
  return {
    kind: 'dig' as const,
    cell: { x, y, z },
    edits: times.length,
    editToMeshP50: percentile(times, 0.5),
    editToMeshP95: percentile(times, 0.95),
    editToMeshMax: times.at(-1) ?? 0,
    inPlace: chunks.stats().inPlace - inPlace,
  };
}

/** Renders frames until `done` holds; fails after DIG.maxFrames. */
async function frames(done: () => boolean, label: string): Promise<void> {
  if (!(await withinFrames(DIG.maxFrames, done)))
    throw new Error(`${label} within ${DIG.maxFrames} frames`);
}
