import type { ColumnCodec } from '../world/codec/columnRecord.ts';
import type { WorldType } from '../world/gen/generateColumn.ts';
import type { StoreCounts } from '../world/ioProtocol.ts';
import type { Inventory } from './inventory.ts';
import type { ItemDropState } from './itemDrops.ts';
import type { Body } from './physics.ts';
import type { InteractionState } from './player.ts';
import type { TimeState } from './time.ts';

/**
 * The storage port (docs « Sauvegarde »): the stores of a save as plain, structured-clone friendly
 * records, behind an async interface. MemoryStorage keeps them in memory (tests, and the fallback
 * when IndexedDB is unavailable); platform/IdbStorage hands them to io.worker. Records are values:
 * nobody changes one after writing or reading it. Item keys and state keys are text (`stateKeys`
 * maps the ids of column payloads), so a save survives a pack whose ids moved.
 */

/** World rules chosen at creation (hostile creatures arrive in M10). */
export interface WorldRules {
  readonly hostiles: boolean;
}

/** Store `worlds`, key `id`. */
export interface WorldRecord {
  readonly id: string;
  readonly name: string;
  /** Milliseconds since 1970 (set by the platform: the simulation has no wall clock). */
  readonly createdAt: number;
  readonly savedAt: number;
  readonly saveVersion: number;
  readonly genVersion: number;
  /** Hash of the pack's state and item keys when saved (a different pack remaps the save). */
  readonly contentHash: number;
  /** Text key of every state id used by the column payloads (index = saved id). */
  readonly stateKeys: readonly string[];
  readonly seed: string;
  readonly worldType: WorldType;
  readonly rules: WorldRules;
  readonly tick: number;
  readonly time: TimeState;
  /** Next entity id (ids are never reused). */
  readonly nextEntityId: number;
  readonly spawn: { readonly x: number; readonly y: number; readonly z: number };
}

/** Store `players`, key `[worldId, playerId]`. */
export interface PlayerRecord {
  readonly worldId: string;
  /** Connection id of the player. */
  readonly playerId: number;
  readonly v: number;
  /** Entity id. */
  readonly id: number;
  readonly body: Body;
  readonly yaw: number;
  readonly pitch: number;
  readonly stamina: number;
  readonly exhausted: boolean;
  readonly restTicks: number;
  readonly viewRadius: number;
  /** Text item keys. */
  readonly inventory: Inventory;
  readonly interaction: InteractionState;
}

/** An item drop as saved with its column (its render interpolation is not kept). */
export type DropRecord = Omit<ItemDropState, 'prevX' | 'prevY' | 'prevZ'>;

/** Store `columns`, key `[worldId, cx, cz]`: the persisted sections and the drops of a column. */
export interface ColumnRecord {
  readonly worldId: string;
  readonly cx: number;
  readonly cz: number;
  readonly v: number;
  readonly codec: ColumnCodec;
  /** Every persisted section (world/codec/columnRecord), deflated or raw. */
  readonly payload: Uint8Array;
  /** Item drops lying in the column. */
  readonly entities: readonly DropRecord[];
  /** Tick its contents were simulated to (unloaded columns stand still until M8 replays them). */
  readonly lastTick: number;
}

export interface ColumnId {
  readonly cx: number;
  readonly cz: number;
}

/** A world as stored. */
export interface StoredWorld {
  readonly world: WorldRecord;
  readonly players: readonly PlayerRecord[];
  readonly columns: readonly ColumnRecord[];
}

/** One save, written in a single transaction. */
export interface SaveBatch extends StoredWorld {
  /** Column records to delete (their column has nothing left to keep). */
  readonly removed: readonly ColumnId[];
}

export interface Storage {
  /** Every world record (menus). */
  listWorlds(): Promise<WorldRecord[]>;
  /** A world with all its records, as stored (not migrated), or undefined. */
  loadWorld(id: string): Promise<StoredWorld | undefined>;
  /** Writes the records of a batch (adding or replacing) and deletes its removed columns. */
  write(batch: SaveBatch): Promise<void>;
  /** Deletes a world and every record of it. */
  deleteWorld(id: string): Promise<void>;
  /** Records of a world in each store (debugging and tests: a deleted world has none). */
  inspect(id: string): Promise<StoreCounts>;
  /** Store `kv`: last world played and other small values. */
  getKv(key: string): Promise<unknown>;
  setKv(key: string, value: unknown): Promise<void>;
}
