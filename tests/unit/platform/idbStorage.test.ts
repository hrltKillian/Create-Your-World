import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdbStorage, openSaveBackend } from '../../../src/platform/IdbStorage.ts';
import { InlineColumnSource } from '../../../src/sim/InlineColumnSource.ts';
import { MemoryStorage } from '../../../src/sim/MemoryStorage.ts';
import {
  compressBatch,
  persistentHash,
  restoreSim,
  snapshotSim,
} from '../../../src/sim/persistence.ts';
import { openIdbStore } from '../../../src/workers/io/idbStore.ts';
import { type IoDeps, startIoWorker } from '../../../src/workers/ioJobs.ts';
import type { IoReply, IoRequest } from '../../../src/world/ioProtocol.ts';
import { registry } from '../../helpers/registry.ts';
import { settle, TEST_WORLD, zlibDeflater } from '../../helpers/save.ts';
import { createTestSim } from '../../helpers/simHarness.ts';

/**
 * In-process stand-in for io.worker: the real ioJobs over fake-indexeddb, every message structured
 * cloned both ways with its transfer list (transferred buffers are detached, as in a browser).
 */
class FakeIoWorker {
  static instances: FakeIoWorker[] = [];
  static deps: Partial<IoDeps> = {};
  onmessage: ((event: MessageEvent<IoReply>) => void) | null = null;
  onerror: ((event: Partial<ErrorEvent>) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  readonly url: URL;
  readonly options: WorkerOptions;
  private deliver: (request: IoRequest) => void = () => {};

  constructor(url: URL, options: WorkerOptions) {
    this.url = url;
    this.options = options;
    FakeIoWorker.instances.push(this);
    startIoWorker(
      {
        post: (message, transfer = []) => {
          const data = structuredClone(message, { transfer });
          queueMicrotask(() => this.onmessage?.({ data } as MessageEvent<IoReply>));
        },
        listen: (handler) => {
          this.deliver = handler;
        },
      },
      { openStore: () => openIdbStore(), deflater: zlibDeflater, ...FakeIoWorker.deps },
    );
  }

  postMessage(message: IoRequest, transfer: ArrayBuffer[] = []): void {
    const data = structuredClone(message, { transfer });
    queueMicrotask(() => this.deliver(data));
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** A flat world with player 1, stripes in column (0, 0) and one block in column (1, 0). */
function editedSim() {
  const s = createTestSim({ seed: 'idb', worldType: 'flat', allowDebug: true });
  s.sim.addPlayer(1, 2);
  settle(s.sim);
  const fill = (x: number, z1: number) => {
    s.host.send({
      type: 'debug.fill',
      x0: x,
      y0: 70,
      z0: 0,
      x1: x,
      y1: 70,
      z1,
      state: 'block:stone',
    });
    s.step();
  };
  for (let x = 0; x < 16; x += 2) fill(x, 15);
  fill(40, 0);
  return s;
}

describe('idb storage (io.worker proxy)', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('Worker', FakeIoWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    FakeIoWorker.instances = [];
    FakeIoWorker.deps = {};
  });

  it('saves a world deflated by io.worker and restores the same persistent state', async () => {
    const { sim } = editedSim();
    const storage = new IdbStorage();
    expect(FakeIoWorker.instances[0]!.options).toEqual({ type: 'module', name: 'io' });
    expect(FakeIoWorker.instances[0]!.url.pathname).toMatch(/\/src\/workers\/io\.worker\.ts$/);
    expect(await storage.available()).toBe(true);
    const batch = await compressBatch(snapshotSim(sim, TEST_WORLD, new Map()), storage);
    // Deflate is kept only when smaller: not for a single block.
    expect(batch.columns.map((c) => c.codec)).toEqual(['deflate-raw', 'raw']);
    await storage.write(batch);
    // Written payloads were transferred to the worker.
    expect(batch.columns.every((c) => c.payload.byteLength === 0)).toBe(true);
    expect(await storage.listWorlds()).toEqual([batch.world]);
    expect(await storage.inspect(TEST_WORLD.id)).toEqual({ worlds: 1, players: 1, columns: 2 });
    const options = { registry, source: new InlineColumnSource(registry), maxInFlight: 8 };
    const restored = (await restoreSim(storage, TEST_WORLD.id, options, storage))!;
    expect(persistentHash(restored.sim)).toBe(persistentHash(sim));
    await storage.setKv('lastWorld', TEST_WORLD.id);
    expect(await storage.getKv('lastWorld')).toBe(TEST_WORLD.id);
    await storage.deleteWorld(TEST_WORLD.id);
    expect(await storage.inspect(TEST_WORLD.id)).toEqual({ worlds: 0, players: 0, columns: 0 });
  });

  it('rejects with the name of the worker-side error (a full disk)', async () => {
    const full = { write: () => Promise.reject(new DOMException('Quota', 'QuotaExceededError')) };
    FakeIoWorker.deps = { openStore: async () => full as never };
    const { sim } = editedSim();
    const storage = new IdbStorage();
    const failed = storage.write(snapshotSim(sim, TEST_WORLD, new Map()));
    await expect(failed).rejects.toMatchObject({ name: 'QuotaExceededError', message: 'Quota' });
  });

  it('fails every request, pending or later, once the worker is gone', async () => {
    FakeIoWorker.deps = { openStore: () => new Promise(() => {}) };
    const storage = new IdbStorage();
    const pending = storage.listWorlds();
    FakeIoWorker.instances[0]!.onerror!({ message: 'boom', preventDefault: () => {} });
    await expect(pending).rejects.toThrow(/io worker failed: boom/);
    await expect(storage.getKv('x')).rejects.toThrow(/boom/);
    storage.dispose();
    expect(FakeIoWorker.instances[0]!.terminated).toBe(true);
  });
});

describe('save backend', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('Worker', FakeIoWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    FakeIoWorker.instances = [];
    FakeIoWorker.deps = {};
  });

  it('uses IndexedDB, or memory when asked or when IndexedDB cannot be used', async () => {
    const idb = await openSaveBackend({ storage: 'idb', forceNoIdb: false });
    expect(idb.storage).toBeInstanceOf(IdbStorage);
    expect(idb.unavailable).toBe(false);
    const memory = await openSaveBackend({ storage: 'memory', forceNoIdb: false });
    expect(memory.storage).toBeInstanceOf(MemoryStorage);
    expect(memory.unavailable).toBe(false);
    const forced = await openSaveBackend({ storage: 'idb', forceNoIdb: true });
    expect(forced.storage).toBeInstanceOf(MemoryStorage);
    expect(forced.unavailable).toBe(true);
    FakeIoWorker.deps = { openStore: () => Promise.reject(new Error('IndexedDB is blocked')) };
    const broken = await openSaveBackend({ storage: 'idb', forceNoIdb: false });
    expect(broken.storage).toBeInstanceOf(MemoryStorage);
    expect(broken.unavailable).toBe(true);
    // The memory fallback still deflates in io.worker (imported worlds hold deflated columns).
    const packed = await broken.deflater.deflate(new Uint8Array(100));
    expect(await broken.deflater.inflate(packed)).toEqual(new Uint8Array(100));
  });
});
