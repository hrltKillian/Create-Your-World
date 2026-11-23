import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOSAVE_MS,
  MAX_RETRY_MS,
  RETRY_MS,
  requestPersistence,
  SaveManager,
  type SaveManagerOptions,
  type SaveStatus,
  storageEstimate,
} from '../../../src/platform/SaveManager.ts';
import { spawnDrop } from '../../../src/sim/itemDrops.ts';
import { MemoryStorage } from '../../../src/sim/MemoryStorage.ts';
import type { SaveBatch } from '../../../src/sim/storage.ts';
import type { Deflater } from '../../../src/world/codec/columnRecord.ts';
import { columnKey } from '../../../src/world/coords.ts';
import { settle, TEST_WORLD, zlibDeflater } from '../../helpers/save.ts';
import { createTestSim } from '../../helpers/simHarness.ts';

/** MemoryStorage that records every batch it is given, and can hold or fail the writes. */
class RecordingStorage extends MemoryStorage {
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

const NOW = 1_800_000_000_000;

/** Every pending promise callback runs (saves only wait on promises: zlib and memory storage). */
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Advances the fake clock, then lets the saves it started finish. */
async function advance(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await drain();
}

const columnsOf = (batch: SaveBatch | undefined) => batch!.columns.map((c) => [c.cx, c.cz]);

/** A loaded flat world with player 1 and its save manager. */
function setup(options: Partial<SaveManagerOptions> = {}) {
  const s = createTestSim({ seed: 'saves', worldType: 'flat', allowDebug: true });
  s.sim.addPlayer(1, 2);
  settle(s.sim);
  const storage = new RecordingStorage();
  const statuses: SaveStatus[] = [];
  const manager = new SaveManager({
    storage,
    deflater: zlibDeflater,
    sim: s.sim,
    info: TEST_WORLD,
    now: () => NOW,
    onStatus: (status) => statuses.push(status),
    ...options,
  });
  /** Fills blocks x, 70, z0..z1 and hands the tick's events to the manager. */
  const edit = (x: number, z0: number, z1 = z0, state = 'block:stone') => {
    s.host.send({ type: 'debug.fill', x0: x, y0: 70, z0, x1: x, y1: 70, z1, state });
    s.step();
    for (const event of s.events) manager.onEvent(event);
    s.events.length = 0;
  };
  return { s, storage, statuses, manager, edit };
}

describe('save manager', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('autosaves every 30 s, writing the columns changed since the last save', async () => {
    const { manager, storage, edit } = setup();
    manager.start();
    edit(3, 3);
    await advance(AUTOSAVE_MS - 1);
    expect(storage.batches).toHaveLength(0);
    await advance(1);
    expect(columnsOf(storage.batches[0])).toEqual([[0, 0]]);
    expect(storage.batches[0]!.world.savedAt).toBe(NOW);
    expect(storage.batches[0]!.players).toHaveLength(1);
    edit(40, 3);
    await advance(AUTOSAVE_MS);
    expect(columnsOf(storage.batches[1])).toEqual([[1, 0]]);
    await advance(AUTOSAVE_MS);
    expect(storage.batches[2]!.columns).toEqual([]);
    expect(storage.batches[2]!.players).toHaveLength(1);
    expect(manager.status).toBe('saved');
    expect(await storage.inspect(TEST_WORLD.id)).toEqual({ worlds: 1, players: 1, columns: 2 });
    expect(await manager.close()).toBe(true);
    await advance(3 * AUTOSAVE_MS);
    expect(storage.batches).toHaveLength(4);
  });

  it('clears only the dirty flags whose column did not change during the save', async () => {
    const { manager, storage, edit } = setup();
    edit(3, 3);
    edit(40, 3);
    await manager.save();
    edit(3, 3, 3, 'block:planks');
    edit(40, 3, 3, 'block:planks');
    let open = () => {};
    storage.gate = new Promise((resolve) => {
      open = resolve;
    });
    const saving = manager.save();
    await drain();
    // Encoded and sent: the write is in progress when column (0, 0) changes again.
    expect(columnsOf(storage.batches[1])).toEqual([
      [0, 0],
      [1, 0],
    ]);
    edit(3, 4);
    storage.gate = null;
    open();
    expect(await saving).toBe(true);
    expect(manager.dirtyColumns()).toContain(columnKey(0, 0));
    expect(manager.dirtyColumns()).not.toContain(columnKey(1, 0));
    await manager.save();
    expect(columnsOf(storage.batches[2])).toEqual([[0, 0]]);
    expect(manager.dirtyColumns()).toEqual([]);
  });

  it('retries a failed save after a delay doubling up to a minute', async () => {
    const { manager, storage, statuses, edit } = setup();
    edit(3, 3);
    storage.failure = new Error('The disk went away');
    manager.start();
    await advance(AUTOSAVE_MS);
    expect(storage.batches).toHaveLength(1);
    expect(manager.status).toBe('error');
    const delays = [RETRY_MS, 2 * RETRY_MS, 4 * RETRY_MS, 8 * RETRY_MS, 16 * RETRY_MS];
    for (const delay of [...delays, MAX_RETRY_MS, MAX_RETRY_MS]) {
      const before = storage.batches.length;
      await advance(delay - 1);
      expect(storage.batches).toHaveLength(before);
      await advance(1);
      expect(storage.batches).toHaveLength(before + 1);
    }
    expect(statuses.filter((s) => s === 'error')).toHaveLength(8);
    storage.failure = null;
    await advance(MAX_RETRY_MS);
    expect(manager.status).toBe('saved');
    expect(columnsOf(storage.batches.at(-1))).toEqual([[0, 0]]);
    const saves = storage.batches.length;
    await advance(AUTOSAVE_MS);
    expect(storage.batches).toHaveLength(saves + 1);
  });

  it('keeps the world in memory and waits for the next autosave when the disk is full', async () => {
    const { manager, storage, statuses, edit } = setup();
    edit(3, 3);
    storage.failure = Object.assign(new Error('Quota exceeded'), { name: 'QuotaExceededError' });
    manager.start();
    await advance(AUTOSAVE_MS);
    expect(statuses).toEqual(['saving', 'quota']);
    expect(manager.dirtyColumns()).toContain(columnKey(0, 0));
    await advance(AUTOSAVE_MS - 1);
    expect(storage.batches).toHaveLength(1);
    storage.failure = null;
    await advance(1);
    expect(manager.status).toBe('saved');
    expect(columnsOf(storage.batches[1])).toEqual([[0, 0]]);
  });

  it('writes raw at once when the page hides, then deflated by the next save', async () => {
    const { manager, storage, edit } = setup();
    for (let x = 0; x < 16; x += 2) edit(x, 0, 15);
    const doc = Object.assign(new EventTarget(), {
      visibilityState: 'visible' as DocumentVisibilityState,
    });
    const win = new EventTarget();
    manager.watchPage({ doc, win });
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(storage.batches).toHaveLength(0);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(storage.batches.map((b) => b.columns.map((c) => c.codec))).toEqual([['raw']]);
    win.dispatchEvent(new Event('pagehide'));
    expect(storage.batches).toHaveLength(2);
    await manager.save();
    expect(storage.batches[2]!.columns.map((c) => c.codec)).toEqual(['deflate-raw']);
    expect((await storage.loadWorld(TEST_WORLD.id))!.columns[0]!.codec).toBe('deflate-raw');
    await manager.close();
    win.dispatchEvent(new Event('pagehide'));
    doc.dispatchEvent(new Event('visibilitychange'));
    manager.flush();
    expect(storage.batches).toHaveLength(4);
  });

  it('drops the write of a save overtaken by a page-hide flush', async () => {
    let open = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const slow: Deflater = {
      deflate: async (raw) => {
        await gate;
        return zlibDeflater.deflate(raw);
      },
      inflate: zlibDeflater.inflate,
    };
    const { manager, storage, edit } = setup({ deflater: slow });
    edit(3, 3);
    const saving = manager.save();
    await drain();
    manager.flush();
    open();
    expect(await saving).toBe(true);
    // Only the flush was written: the older snapshot would have undone it.
    expect(storage.batches).toHaveLength(1);
    expect(manager.dirtyColumns()).toContain(columnKey(0, 0));
  });

  it('rewrites the columns of item drops and removes a column left empty', async () => {
    const { s, manager, storage } = setup();
    const drop = spawnDrop(s.sim, { item: 'item:sand', count: 2 }, 40.5, 66, 3.5);
    await manager.save();
    expect(columnsOf(storage.batches[0])).toEqual([[1, 0]]);
    await manager.save();
    expect(columnsOf(storage.batches[1])).toEqual([[1, 0]]);
    s.sim.entities.delete(drop.id);
    storage.failure = new Error('Busy');
    expect(await manager.save()).toBe(false);
    storage.failure = null;
    // The failed write's removal is sent again.
    expect(await manager.save()).toBe(true);
    expect(storage.batches.map((b) => b.removed)).toEqual([
      [],
      [],
      [{ cx: 1, cz: 0 }],
      [{ cx: 1, cz: 0 }],
    ]);
    expect(await storage.inspect(TEST_WORLD.id)).toMatchObject({ columns: 0 });
    await manager.save();
    expect(storage.batches[4]!.removed).toEqual([]);
  });

  it('saves when a changed column unloads', async () => {
    const { manager, storage, edit } = setup();
    edit(3, 3);
    manager.onEvent({ type: 'columnUnloaded', cx: 5, cz: 5 });
    await drain();
    expect(storage.batches).toHaveLength(0);
    manager.onEvent({ type: 'columnUnloaded', cx: 0, cz: 0 });
    await drain();
    expect(columnsOf(storage.batches[0])).toEqual([[0, 0]]);
  });

  it('asks for persistent storage and reads the estimate', async () => {
    const browser = {
      persist: async () => true,
      estimate: async () => ({ usage: 1200, quota: 50_000 }),
    } as unknown as StorageManager;
    expect(await requestPersistence(browser)).toBe(true);
    expect(await storageEstimate(browser)).toEqual({ usage: 1200, quota: 50_000 });
    // Node has no navigator.storage.
    expect(await requestPersistence()).toBe(false);
    expect(await storageEstimate()).toBeNull();
  });
});
