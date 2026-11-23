import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { Registry } from '../../src/content/registry.ts';
import { COLUMN_LIT } from '../../src/sim/ColumnPipeline.ts';
import { createHost } from '../../src/sim/host.ts';
import { InlineColumnSource } from '../../src/sim/InlineColumnSource.ts';
import { MemoryStorage } from '../../src/sim/MemoryStorage.ts';
import {
  columnDigest,
  compressBatch,
  restoreSim,
  type StoredColumns,
  snapshotSim,
  type WorldInfo,
} from '../../src/sim/persistence.ts';
import type { Simulation } from '../../src/sim/Simulation.ts';
import type { SaveBatch, Storage } from '../../src/sim/storage.ts';
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

/** MemoryStorage that records every batch it is given, and can hold or fail the writes. */
export class RecordingStorage extends MemoryStorage {
  readonly batches: SaveBatch[] = [];
  failure: Error | null = null;
  gate: Promise<void> | null = null;

  override async write(batch: SaveBatch): Promise<void> {
    this.batches.push(batch);
    if (this.gate) await this.gate;
    if (this.failure) throw this.failure;
    return super.write(batch);
  }
}

/**
 * Writes a full save of `sim` (deflated) over the records of `stored`, and returns the column
 * records now stored.
 */
export async function saveTo(
  storage: Storage,
  sim: Simulation,
  stored: StoredColumns = new Map(),
): Promise<Map<number, string>> {
  const batch = await compressBatch(snapshotSim(sim, TEST_WORLD, stored), zlibDeflater);
  await storage.write(batch);
  return new Map(
    batch.columns.map((c) => [columnKey(c.cx, c.cz), columnDigest(c.entities, c.blockEntities)]),
  );
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
