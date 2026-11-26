import type { ColumnCodec } from '../world/codec/columnRecord.ts';
import type { WorldType } from '../world/gen/generateColumn.ts';
import type { StoreCounts } from '../world/ioProtocol.ts';
import type { BlockEntity } from './blockEntities.ts';
import type { CraftEntry } from './craftQueue.ts';
import type { CreatureState } from './creatures.ts';
import type { Waypoint } from './exploration.ts';
import type { Inventory, ItemStack } from './inventory.ts';
import type { ItemDropState } from './itemDrops.ts';
import type { Body } from './physics.ts';
import type { BlockCell, InteractionState } from './player.ts';
import type { Skills, TaskState } from './progression.ts';
import type { QuestState } from './quests.ts';
import type { SurvivalState } from './survival.ts';
import type { TimeState } from './time.ts';

/**
 * The storage port (docs « Sauvegarde »): the stores of a save as plain, structured-clone friendly
 * records, behind an async interface. MemoryStorage keeps them in memory (tests, and the fallback
 * when IndexedDB is unavailable); platform/IdbStorage hands them to io.worker. Records are values:
 * nobody changes one after writing or reading it. Item keys and state keys are text (`stateKeys`
 * maps the ids of column payloads), so a save survives a pack whose ids moved.
 */

/** World rules chosen at creation. */
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
  /** Block updates due or waiting: x, y, z, kind and ticks left, flat (BlockUpdateQueue). */
  readonly blockUpdates?: readonly number[];
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
  /** Text item keys; its length is the inventory size (from save version 7: 32 before). */
  readonly inventory: Inventory;
  /** The cursor stack of the screen open when saved, text key (from save version 7). */
  readonly cursor: ItemStack | null;
  readonly interaction: InteractionState;
  /** The craft queue, its reserved ingredients with text item keys (from save version 2). */
  readonly craft: readonly CraftEntry[];
  /** Item keys and tags seen (recipe reveal), sorted (from save version 2). */
  readonly seen: readonly string[];
  /** Gauges and the last environment sample (from save version 3). */
  readonly survival: SurvivalState;
  /** Worn items, one slot per wear slot, text keys (from save version 3). */
  readonly equipment: Inventory;
  /** The bedroll to come back to (from save version 3). */
  readonly respawn: BlockCell | null;
  /** Abandoned Packs left by deaths (from save version 3). */
  readonly graves: readonly BlockCell[];
  /** The quests unlocked, by key, in unlock order (save version 11). */
  readonly quests: Readonly<Record<string, QuestState>>;
  /** The quest pinned to the compass (save version 11). */
  readonly pinned: string | null;
  /** Biome keys stood in, sorted (save version 11). */
  readonly biomes: readonly string[];
  /** Experience, skill points, tasks held, draws and the last redraw's day (save version 12). */
  readonly xp: number;
  readonly skills: Readonly<Skills>;
  readonly tasks: readonly TaskState[];
  readonly taskDraws: number;
  readonly rerollDay: number;
  /** Explored column keys, sorted, and the waypoints (save version 13). */
  readonly explored: readonly string[];
  readonly waypoints: readonly Waypoint[];
  /** Has drunk at least once (from save version 4). */
  readonly drank: boolean;
  /** Creature key → MET (1) or STUDIED (2) (version 9). */
  readonly bestiary: Readonly<Record<string, number>>;
  /** A fight in progress: loud, invulnerable and weapon cooldown ticks left (save version 5). */
  readonly fightTicks: number;
  readonly invulnerable: number;
  readonly attackCooldown: number;
}

/** An item drop as saved with its column (its render interpolation is not kept). */
export type DropRecord = Omit<ItemDropState, 'prevX' | 'prevY' | 'prevZ'>;

/**
 * A creature (never a hostile one) as saved with the column it stands in: its brain's state and
 * its path's `pathLength` cells (from save version 4).
 */
export type CreatureRecord = Omit<CreatureState, 'prevX' | 'prevY' | 'prevZ' | 'prevYaw'>;

/** An entity saved with its column. */
export type EntityRecord = DropRecord | CreatureRecord;

/** A chest or station as saved with its column (text item keys). */
export type BlockEntityRecord = BlockEntity;

/**
 * Store `columns`, key `[worldId, cx, cz]`: the persisted sections, the drops and the block
 * entities of a column.
 */
export interface ColumnRecord {
  readonly worldId: string;
  readonly cx: number;
  readonly cz: number;
  readonly v: number;
  readonly codec: ColumnCodec;
  /** Every persisted section (world/codec/columnRecord), deflated or raw. */
  readonly payload: Uint8Array;
  /** Item drops lying in the column, and its creatures (from save version 4). */
  readonly entities: readonly EntityRecord[];
  /** The column's first generation placed a herd: it never places one again (version 4). */
  readonly herds: boolean;
  /** Chests and stations of the column, by cell key (from save version 2). */
  readonly blockEntities: readonly BlockEntityRecord[];
  /**
   * Tick of the save. Each station keeps its own last simulated tick (`tick`): out of the
   * simulation radius it stands still, and catches up from that tick when it comes back.
   */
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
