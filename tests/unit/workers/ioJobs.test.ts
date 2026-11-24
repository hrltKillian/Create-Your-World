import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openIdbStore } from '../../../src/workers/io/idbStore.ts';
import { type IoDeps, startIoWorker } from '../../../src/workers/ioJobs.ts';
import type { IoBatch, IoReply, IoRequest } from '../../../src/world/ioProtocol.ts';
import { zlibDeflater } from '../../helpers/save.ts';

/** startIoWorker behind a fake port: requests in, replies (and their transfer lists) out. */
function ioWorker(deps: Partial<IoDeps> = {}) {
  const replies: { message: IoReply; transfer: ArrayBuffer[] }[] = [];
  let deliver: (request: IoRequest) => void = () => {};
  startIoWorker(
    {
      post: (message, transfer = []) => replies.push({ message, transfer }),
      listen: (handler) => {
        deliver = handler;
      },
    },
    { openStore: () => openIdbStore(), deflater: zlibDeflater, ...deps },
  );
  return {
    replies,
    send: (...requests: IoRequest[]) => {
      for (const request of requests) deliver(request);
    },
    /** The replies once `n` have arrived. */
    settled: async (n: number) => {
      await vi.waitFor(() => expect(replies).toHaveLength(n));
      return replies.map((r) => r.message);
    },
  };
}

const BATCH: IoBatch = {
  world: { id: 'w1' },
  players: [{ worldId: 'w1', playerId: 1 }],
  columns: [{ worldId: 'w1', cx: 2, cz: 3, payload: new Uint8Array([1, 2, 3]) }],
  removed: [],
};

describe('io jobs', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
  });

  it('answers each request in arrival order, with its id', async () => {
    const io = ioWorker();
    io.send(
      { id: 1, op: 'write', batch: BATCH },
      { id: 2, op: 'loadWorld', worldId: 'w1' },
      { id: 3, op: 'setKv', key: 'lastWorld', value: 'w1' },
      { id: 4, op: 'getKv', key: 'lastWorld' },
      { id: 5, op: 'listWorlds' },
      { id: 6, op: 'deleteWorld', worldId: 'w1' },
      { id: 7, op: 'inspect', worldId: 'w1' },
    );
    const replies = await io.settled(7);
    expect(replies.map((r) => [r.id, r.ok])).toEqual([1, 2, 3, 4, 5, 6, 7].map((id) => [id, true]));
    const value = (id: number) => (replies[id - 1] as { value: unknown }).value;
    expect(value(2)).toEqual({
      world: BATCH.world,
      players: BATCH.players,
      columns: BATCH.columns,
    });
    expect(value(4)).toBe('w1');
    expect(value(5)).toEqual([BATCH.world]);
    expect(value(7)).toEqual({ worlds: 0, players: 0, columns: 0 });
    // The loaded payloads go back transferred (exact-size copies read from the database).
    const loaded = value(2) as IoBatch;
    expect(io.replies[1]!.transfer).toEqual([loaded.columns[0]!.payload.buffer]);
  });

  it('deflates and inflates, transferring the result', async () => {
    const io = ioWorker();
    const raw = new Uint8Array(4096).fill(9);
    io.send({ id: 1, op: 'deflate', bytes: raw });
    const [deflated] = await io.settled(1);
    const packed = (deflated as { value: Uint8Array }).value;
    expect(packed.length).toBeLessThan(64);
    expect(io.replies[0]!.transfer).toEqual([packed.buffer]);
    io.send({ id: 2, op: 'inflate', bytes: packed });
    const replies = await io.settled(2);
    expect((replies[1] as { value: Uint8Array }).value).toEqual(raw);
  });

  it('answers errors with their name, and opens the database again after a failure', async () => {
    let opens = 0;
    const io = ioWorker({
      openStore: () =>
        ++opens === 1
          ? Promise.reject(new DOMException('No IndexedDB here', 'InvalidStateError'))
          : openIdbStore(),
    });
    io.send(
      { id: 1, op: 'open' },
      { id: 2, op: 'open' },
      { id: 3, op: 'inflate', bytes: new Uint8Array([0xff, 0xff]) },
    );
    // By id: the inflate runs on the codec queue, beside the database requests.
    const replies = (await io.settled(3)).sort((a, b) => a.id - b.id);
    expect(replies[0]).toEqual({
      id: 1,
      ok: false,
      name: 'InvalidStateError',
      message: 'No IndexedDB here',
    });
    expect(replies[1]).toEqual({ id: 2, ok: true, value: true });
    expect(replies[2]).toMatchObject({ id: 3, ok: false, name: 'Error' });
    expect(opens).toBe(2);
  });

  it('runs a write without waiting behind the deflate jobs sent before it', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = {
      ...zlibDeflater,
      deflate: async (raw: Uint8Array) => {
        await held;
        return raw;
      },
    };
    const io = ioWorker({ deflater: slow });
    io.send(
      { id: 1, op: 'deflate', bytes: new Uint8Array([1]) },
      { id: 2, op: 'deflate', bytes: new Uint8Array([2]) },
      { id: 3, op: 'write', batch: BATCH },
    );
    // The page-hide flush lands while the autosave's deflates still run.
    expect((await io.settled(1))[0]).toMatchObject({ id: 3, ok: true });
    release();
    expect((await io.settled(3)).map((r) => r.id)).toEqual([3, 1, 2]);
  });
});
