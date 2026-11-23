import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openIdbStore } from '../../../src/workers/io/idbStore.ts';
import type { IoBatch, IoColumn } from '../../../src/world/ioProtocol.ts';

const column = (worldId: string, cx: number, cz: number, byte = cx): IoColumn => ({
  worldId,
  cx,
  cz,
  payload: new Uint8Array([byte, 7, 7]),
});

/** A world with two players and columns (0, 0), (1, 0) and (-1, 3). */
function batch(worldId: string): IoBatch {
  return {
    world: { id: worldId, name: `World ${worldId}` } as IoBatch['world'],
    players: [
      { worldId, playerId: 1 },
      { worldId, playerId: 2 },
    ],
    columns: [column(worldId, 0, 0), column(worldId, 1, 0), column(worldId, -1, 3)],
    removed: [],
  };
}

describe('idb store', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
  });

  it('writes a batch and loads the world back, with small values beside', async () => {
    const store = await openIdbStore();
    await store.write(batch('w1'));
    expect(await store.listWorlds()).toEqual([batch('w1').world]);
    const loaded = (await store.loadWorld('w1'))!;
    expect(loaded.world).toEqual(batch('w1').world);
    expect(loaded.players).toEqual(batch('w1').players);
    expect(loaded.columns).toHaveLength(3);
    expect(loaded.columns).toEqual(expect.arrayContaining([...batch('w1').columns]));
    expect(await store.loadWorld('missing')).toBeUndefined();
    expect(await store.getKv('lastWorld')).toBeUndefined();
    await store.setKv('lastWorld', 'w1');
    expect(await store.getKv('lastWorld')).toBe('w1');
  });

  it('replaces records and deletes the removed columns', async () => {
    const store = await openIdbStore();
    await store.write(batch('w1'));
    await store.write({
      world: { id: 'w1', name: 'Renamed' } as IoBatch['world'],
      players: [],
      columns: [column('w1', 0, 0, 42)],
      removed: [{ cx: 1, cz: 0 }],
    });
    const loaded = (await store.loadWorld('w1'))!;
    expect(loaded.world).toMatchObject({ name: 'Renamed' });
    expect(loaded.players).toHaveLength(2);
    expect(loaded.columns.map((c) => [c.cx, c.cz, c.payload[0]])).toEqual([
      [-1, 3, -1 & 0xff],
      [0, 0, 42],
    ]);
  });

  it('deletes a world through its key ranges and leaves the others alone', async () => {
    const store = await openIdbStore();
    for (const id of ['w', 'w1', 'w10']) await store.write(batch(id));
    expect(await store.inspect('w1')).toEqual({ worlds: 1, players: 2, columns: 3 });
    await store.deleteWorld('w1');
    expect(await store.inspect('w1')).toEqual({ worlds: 0, players: 0, columns: 0 });
    expect(await store.inspect('w')).toEqual({ worlds: 1, players: 2, columns: 3 });
    expect(await store.inspect('w10')).toEqual({ worlds: 1, players: 2, columns: 3 });
    expect((await store.listWorlds()).map((w) => w.id)).toEqual(['w', 'w10']);
  });

  it('keeps nothing of a batch that cannot be written', async () => {
    const store = await openIdbStore();
    const bad = { ...batch('w1'), players: [{ worldId: 'w1' } as IoBatch['players'][number]] };
    await expect(store.write(bad)).rejects.toMatchObject({ name: 'DataError' });
    expect(await store.inspect('w1')).toEqual({ worlds: 0, players: 0, columns: 0 });
  });

  it('keeps its records across connections', async () => {
    await (await openIdbStore()).write(batch('w1'));
    expect(await (await openIdbStore()).inspect('w1')).toEqual({
      worlds: 1,
      players: 2,
      columns: 3,
    });
  });
});
