import { columnKey } from '../world/coords.ts';
import type { StoreCounts } from '../world/ioProtocol.ts';
import type {
  ColumnRecord,
  PlayerRecord,
  SaveBatch,
  Storage,
  StoredWorld,
  WorldRecord,
} from './storage.ts';

interface WorldEntry {
  world: WorldRecord;
  readonly players: Map<number, PlayerRecord>;
  readonly columns: Map<number, ColumnRecord>;
}

/**
 * Storage in memory: tests, and the game when IndexedDB is unavailable (« Saving unavailable »
 * banner: the world lives as long as the page). Keeps the records it is given (they are values).
 */
export class MemoryStorage implements Storage {
  private readonly worlds = new Map<string, WorldEntry>();
  private readonly kv = new Map<string, unknown>();

  async listWorlds(): Promise<WorldRecord[]> {
    return [...this.worlds.values()].map((entry) => entry.world);
  }

  async loadWorld(id: string): Promise<StoredWorld | undefined> {
    const entry = this.worlds.get(id);
    if (!entry) return undefined;
    return {
      world: entry.world,
      players: [...entry.players.values()],
      columns: [...entry.columns.values()],
    };
  }

  async write(batch: SaveBatch): Promise<void> {
    const id = batch.world.id;
    let entry = this.worlds.get(id);
    if (!entry) {
      entry = { world: batch.world, players: new Map(), columns: new Map() };
      this.worlds.set(id, entry);
    }
    entry.world = batch.world;
    for (const player of batch.players) entry.players.set(player.playerId, player);
    for (const column of batch.columns) entry.columns.set(columnKey(column.cx, column.cz), column);
    for (const { cx, cz } of batch.removed) entry.columns.delete(columnKey(cx, cz));
  }

  async deleteWorld(id: string): Promise<void> {
    this.worlds.delete(id);
  }

  async inspect(id: string): Promise<StoreCounts> {
    const entry = this.worlds.get(id);
    return {
      worlds: entry ? 1 : 0,
      players: entry?.players.size ?? 0,
      columns: entry?.columns.size ?? 0,
    };
  }

  async getKv(key: string): Promise<unknown> {
    return this.kv.get(key);
  }

  async setKv(key: string, value: unknown): Promise<void> {
    this.kv.set(key, value);
  }
}
