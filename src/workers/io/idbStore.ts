import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type {
  IoBatch,
  IoColumn,
  IoPlayer,
  IoWorld,
  IoWorldRecords,
  StoreCounts,
} from '../../world/ioProtocol.ts';

/** The IndexedDB database of the saves (docs « Sauvegarde »). */
export const DB_NAME = 'create-your-world';
const DB_VERSION = 1;

interface SaveSchema extends DBSchema {
  worlds: { key: string; value: IoWorld };
  players: { key: [string, number]; value: IoPlayer };
  columns: { key: [string, number, number]; value: IoColumn };
  kv: { key: string; value: unknown };
}

const WORLD_STORES = ['worlds', 'players', 'columns'] as const;

/** Every key `[worldId, …]` of one world (an array sorts after the numbers that follow the id). */
function worldRange(worldId: string): IDBKeyRange {
  return IDBKeyRange.bound([worldId], [worldId, []]);
}

/** The save stores in IndexedDB (io.worker only: the main thread goes through IdbStorage). */
export class IdbStore {
  private readonly db: IDBPDatabase<SaveSchema>;

  constructor(db: IDBPDatabase<SaveSchema>) {
    this.db = db;
  }

  listWorlds(): Promise<IoWorld[]> {
    return this.db.getAll('worlds');
  }

  /** A world with all its records, or undefined. */
  async loadWorld(worldId: string): Promise<IoWorldRecords | undefined> {
    const tx = this.db.transaction(WORLD_STORES, 'readonly');
    const range = worldRange(worldId);
    const [world, players, columns] = await Promise.all([
      tx.objectStore('worlds').get(worldId),
      tx.objectStore('players').getAll(range),
      tx.objectStore('columns').getAll(range),
    ]);
    return world ? { world, players, columns } : undefined;
  }

  /** Puts the records of a batch and deletes its removed columns, in one transaction. */
  async write(batch: IoBatch): Promise<void> {
    const tx = this.db.transaction(WORLD_STORES, 'readwrite');
    const players = tx.objectStore('players');
    const columns = tx.objectStore('columns');
    const worldId = batch.world.id;
    // Every request is awaited, so a failing one rejects here and not as an unhandled rejection;
    // tx.done rejects with the transaction's error (QuotaExceededError on a full disk).
    const requests: Promise<unknown>[] = [tx.done];
    try {
      requests.push(tx.objectStore('worlds').put(batch.world));
      for (const player of batch.players) requests.push(players.put(player));
      for (const column of batch.columns) requests.push(columns.put(column));
      for (const { cx, cz } of batch.removed) requests.push(columns.delete([worldId, cx, cz]));
    } catch (error) {
      // A record without a valid key throws at once: nothing of the batch is kept.
      tx.abort();
      await Promise.allSettled(requests);
      throw error;
    }
    await Promise.all(requests);
  }

  /** Deletes a world and every record of it, in one transaction. */
  async deleteWorld(worldId: string): Promise<void> {
    const tx = this.db.transaction(WORLD_STORES, 'readwrite');
    const range = worldRange(worldId);
    await Promise.all([
      tx.objectStore('worlds').delete(worldId),
      tx.objectStore('players').delete(range),
      tx.objectStore('columns').delete(range),
      tx.done,
    ]);
  }

  async inspect(worldId: string): Promise<StoreCounts> {
    const tx = this.db.transaction(WORLD_STORES, 'readonly');
    const range = worldRange(worldId);
    const [worlds, players, columns] = await Promise.all([
      tx.objectStore('worlds').count(worldId),
      tx.objectStore('players').count(range),
      tx.objectStore('columns').count(range),
    ]);
    return { worlds, players, columns };
  }

  getKv(key: string): Promise<unknown> {
    return this.db.get('kv', key);
  }

  async setKv(key: string, value: unknown): Promise<void> {
    await this.db.put('kv', value, key);
  }
}

/** Opens (and on first use creates) the save database. */
export async function openIdbStore(name = DB_NAME): Promise<IdbStore> {
  const db = await openDB<SaveSchema>(name, DB_VERSION, {
    upgrade(database) {
      database.createObjectStore('worlds', { keyPath: 'id' });
      database.createObjectStore('players', { keyPath: ['worldId', 'playerId'] });
      database.createObjectStore('columns', { keyPath: ['worldId', 'cx', 'cz'] });
      database.createObjectStore('kv');
    },
  });
  return new IdbStore(db);
}
