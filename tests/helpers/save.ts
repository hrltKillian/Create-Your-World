import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { Registry } from '../../src/content/registry.ts';
import { COLUMN_LIT } from '../../src/sim/ColumnPipeline.ts';
import { createHost } from '../../src/sim/host.ts';
import { InlineColumnSource } from '../../src/sim/InlineColumnSource.ts';
import {
  compressBatch,
  restoreSim,
  snapshotSim,
  type WorldInfo,
} from '../../src/sim/persistence.ts';
import type { Simulation } from '../../src/sim/Simulation.ts';
import type { Storage } from '../../src/sim/storage.ts';
import type { Deflater } from '../../src/world/codec/columnRecord.ts';
import { blockToColumn, columnKey } from '../../src/world/coords.ts';
import { registry } from './registry.ts';
import { withTicks } from './simHarness.ts';

/** deflate-raw under Node (zlib), the format CompressionStream('deflate-raw') writes. */
export const zlibDeflater: Deflater = {
  deflate: async (raw) => new Uint8Array(deflateRawSync(raw)),
  inflate: async (packed) => new Uint8Array(inflateRawSync(packed)),
};

export const TEST_WORLD: WorldInfo = {
  id: 'world-1',
  name: 'Test world',
  createdAt: 1_700_000_000_000,
  savedAt: 1_700_000_000_000,
  rules: { hostiles: false },
};

/**
 * Writes a full save of `sim` (deflated) over the records of `stored` (their column keys), and
 * returns the column keys now stored.
 */
export async function saveTo(
  storage: Storage,
  sim: Simulation,
  stored: ReadonlySet<number> = new Set(),
): Promise<Set<number>> {
  const batch = await compressBatch(snapshotSim(sim, TEST_WORLD, stored), zlibDeflater);
  await storage.write(batch);
  return new Set(batch.columns.map((c) => columnKey(c.cx, c.cz)));
}

/** Restores the test world as an inline simulation (debug commands allowed) with tick helpers. */
export async function restoreFrom(storage: Storage, reg: Registry = registry) {
  const source = new InlineColumnSource(reg);
  const options = { registry: reg, source, maxInFlight: 8, allowDebug: true };
  const restored = await restoreSim(storage, TEST_WORLD.id, options, zlibDeflater);
  if (!restored) throw new Error('No saved world');
  const { sim } = restored;
  return { ...withTicks({ sim, host: createHost(sim, 1), events: [] }), restored };
}

/** Loads the world around the players without ticking (the loading screen), up to 500 pumps. */
export function settle(sim: Simulation): void {
  for (let i = 0; i < 500; i++) {
    sim.pump(12, []);
    const { arrivals, requested } = sim.backlog();
    const lit = [...sim.players.values()].every(
      (p) => sim.columnState(blockToColumn(p.body.x), blockToColumn(p.body.z)) >= COLUMN_LIT,
    );
    if (lit && arrivals === 0 && requested === 0) return;
  }
  throw new Error('The world did not load');
}
