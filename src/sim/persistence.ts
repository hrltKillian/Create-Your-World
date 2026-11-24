import type { Registry } from '../content/registry.ts';
import { isFiniteNumber, isPoint, isWhole } from '../core/guards.ts';
import { fnv1aBytes, fnv1aString } from '../core/hash.ts';
import { createLogger } from '../core/log.ts';
import { persistedSections } from '../world/Column.ts';
import {
  compressPayload,
  type Deflater,
  expandPayload,
  packSections,
  unpackSections,
} from '../world/codec/columnRecord.ts';
import { migrate, type PlainRecord, SAVE_VERSION } from '../world/codec/migrations.ts';
import {
  blockToColumn,
  cellKey,
  columnKey,
  columnKeyX,
  columnKeyZ,
  insideBorder,
  SECTION_SIZE,
  toColumn,
} from '../world/coords.ts';
import { GEN_VERSION, WORLD_TYPES, type WorldType } from '../world/gen/generateColumn.ts';
import type { SavedSection } from '../world/protocol.ts';
import { refundUnknownCrafts } from './craftQueue.ts';
import { creatureDef, isGone, isHostile } from './creatures.ts';
import type { SimEvent } from './events.ts';
import { type Entity, type SimOptions, Simulation } from './Simulation.ts';
import {
  blockEntityRecord,
  creatureRecord,
  dropRecord,
  insideWorld,
  playerRecord,
  readBlockEntity,
  readCreature,
  readDrop,
  readPlayer,
} from './saveRecords.ts';
import { canonicalJson } from './stateHash.ts';
import type {
  BlockEntityRecord,
  ColumnRecord,
  EntityRecord,
  PlayerRecord,
  SaveBatch,
  Storage,
  WorldRecord,
  WorldRules,
} from './storage.ts';
import { deserializeTime, serializeTime } from './time.ts';

/**
 * Persistence of a simulation (docs « Sauvegarde »): snapshots of its persistent state as store
 * records, and a simulation rebuilt from them. Persistent = world meta (seed, clock, entity ids,
 * spawn), players, and for each column its persisted sections, item drops, creatures (never the
 * hostile ones; parked with an unloaded column or not), block entities (chests, stations) and
 * whether it placed a herd. A restored world holds every saved creature; those of the columns not
 * loaded by its first tick leave with them (spawning.ts `departs`). Light, meshes,
 * untouched terrain and the streaming state are rebuilt: saved
 * sections go back to the edit store, and generation lays them over the terrain (the « Colonne déjà
 * modifiée » path).
 */

const log = createLogger('persistence');

/** What the platform knows of a world besides its simulation. */
export interface WorldInfo {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly savedAt: number;
  readonly rules: WorldRules;
}

/** Hash of the pack's state and item keys (another hash: the save comes from another pack). */
export function contentHash(registry: Registry): number {
  const states = fnv1aString(registry.states.map((s) => s.key).join('\n'));
  return fnv1aString(registry.items.map((item) => item.key).join('\n'), states);
}

function worldRecord(sim: Simulation, info: WorldInfo): WorldRecord {
  return {
    id: info.id,
    name: info.name,
    createdAt: info.createdAt,
    savedAt: info.savedAt,
    saveVersion: SAVE_VERSION,
    genVersion: GEN_VERSION,
    contentHash: contentHash(sim.registry),
    stateKeys: sim.registry.states.map((s) => s.key),
    seed: sim.seed,
    worldType: sim.worldType,
    rules: { hostiles: info.rules.hostiles },
    tick: sim.tick,
    time: serializeTime(sim.time),
    nextEntityId: sim.nextEntityId,
    spawn: { x: sim.spawn.x, y: sim.spawn.y, z: sim.spawn.z },
  };
}

/**
 * The column records in storage: column key → digest of the entities, block entities and herd
 * flag each one holds (`columnDigest`). Kept by whoever writes the records, for snapshotSim.
 */
export type StoredColumns = ReadonlyMap<number, string>;

/**
 * Digest of what a column record holds besides its sections, its entities (item drops,
 * creatures), block entities and herd flag: equal digests, equal contents; '' for none.
 */
export function columnDigest(
  entities: readonly EntityRecord[] | undefined,
  blockEntities: readonly BlockEntityRecord[] | undefined,
  herds = false,
): string {
  const noEntities = entities === undefined || entities.length === 0;
  const noBlockEntities = blockEntities === undefined || blockEntities.length === 0;
  if (noEntities && noBlockEntities && !herds) return '';
  return canonicalJson({ drops: entities ?? [], blockEntities: blockEntities ?? [], herds });
}

/**
 * Saved entities by column key, in entity (id) order: item drops and the creatures that are not
 * hostile nor leaving, dormant and parked ones included.
 */
function entitiesByColumn(sim: Simulation): Map<number, EntityRecord[]> {
  const out = new Map<number, EntityRecord[]>();
  const add = (entity: Entity): void => {
    let record: EntityRecord;
    if (entity.kind === 'itemDrop') record = dropRecord(entity);
    else if (entity.kind !== 'creature' || isGone(entity)) return;
    else if (isHostile(creatureDef(sim, entity))) return;
    else record = creatureRecord(entity);
    const key = columnKey(blockToColumn(entity.body.x), blockToColumn(entity.body.z));
    const list = out.get(key);
    if (list) list.push(record);
    else out.set(key, [record]);
  };
  sim.entities.forEach(add);
  for (const parked of sim.parked.values()) parked.forEach(add);
  for (const list of out.values()) list.sort((a, b) => a.id - b.id);
  return out;
}

/** Saved block entities by column key, each list in cell-key order. */
function blockEntitiesByColumn(sim: Simulation): Map<number, BlockEntityRecord[]> {
  const out = new Map<number, BlockEntityRecord[]>();
  const keys = [...sim.blockEntities.keys()].sort((a, b) => a - b);
  for (const key of keys) {
    const entity = sim.blockEntities.get(key)!;
    const column = columnKey(toColumn(entity.x), toColumn(entity.z));
    const list = out.get(column);
    if (list) list.push(blockEntityRecord(entity));
    else out.set(column, [blockEntityRecord(entity)]);
  }
  return out;
}

/** Persisted sections of a column: its own while loaded, else those kept in the edit store. */
function savedSections(sim: Simulation, key: number): readonly SavedSection[] {
  const column = sim.world.columns.get(key);
  return column ? persistedSections(column) : (sim.edits.get(key) ?? []);
}

/**
 * Every record of a world, payloads raw (synchronous: usable when the tab hides). Each column with
 * persisted sections, entities, block entities or a herd placed gets a record rebuilt from all of
 * them; the columns of `stored` left with nothing are removed. With `only` (the columns edited
 * since the last save), the other columns are left out unless their entities or block entities
 * differ from their record's (`columnDigest`): drops and creatures move, age, go and come, and
 * chests and stations change contents and tick, without edits, while their column is loaded; they
 * stay as they are, frozen, while it is not.
 */
export function snapshotSim(
  sim: Simulation,
  info: WorldInfo,
  stored: StoredColumns,
  only?: ReadonlySet<number>,
): SaveBatch {
  const entities = entitiesByColumn(sim);
  const blockEntities = blockEntitiesByColumn(sim);
  const keys = new Set([...entities.keys(), ...blockEntities.keys(), ...sim.herdColumns]);
  for (const [key, column] of sim.world.columns) if (column.persisted !== 0) keys.add(key);
  for (const key of sim.edits.keys()) keys.add(key);
  const digest = (key: number) =>
    columnDigest(entities.get(key), blockEntities.get(key), sim.herdColumns.has(key));
  const changed = (key: number) =>
    only === undefined || only.has(key) || digest(key) !== (stored.get(key) ?? '');
  const columns = [...keys]
    .filter(changed)
    .sort((a, b) => a - b)
    .map(
      (key): ColumnRecord => ({
        worldId: info.id,
        cx: columnKeyX(key),
        cz: columnKeyZ(key),
        v: SAVE_VERSION,
        codec: 'raw',
        payload: packSections(savedSections(sim, key)),
        entities: entities.get(key) ?? [],
        blockEntities: blockEntities.get(key) ?? [],
        herds: sim.herdColumns.has(key),
        lastTick: sim.tick,
      }),
    );
  const removed = [...stored.keys()]
    .filter((key) => !keys.has(key))
    .map((key) => ({ cx: columnKeyX(key), cz: columnKeyZ(key) }));
  const players = [...sim.players.values()].map((player) => playerRecord(info.id, player));
  return { world: worldRecord(sim, info), players, columns, removed };
}

/** The batch with each raw column payload deflated (one deflate-raw per record) when smaller. */
export async function compressBatch(batch: SaveBatch, deflater: Deflater): Promise<SaveBatch> {
  const columns = await Promise.all(
    batch.columns.map(async (record) =>
      record.codec === 'raw'
        ? { ...record, ...(await compressPayload(record.payload, deflater)) }
        : record,
    ),
  );
  return { ...batch, columns };
}

/**
 * FNV-1a over the canonical snapshot (raw payloads hashed as bytes): two simulations with the same
 * persistent state have the same hash, whatever they hold in memory (light, loaded columns).
 */
export function persistentHash(sim: Simulation): number {
  const info = { id: '', name: '', createdAt: 0, savedAt: 0, rules: { hostiles: true } };
  const batch = snapshotSim(sim, info, new Map());
  const columns = batch.columns.map((c) => ({ ...c, payload: fnv1aBytes(c.payload) }));
  return fnv1aString(canonicalJson({ world: batch.world, players: batch.players, columns }));
}

/** Everything a restored simulation needs besides its world (registry, column source…). */
export type RestoreOptions = Omit<SimOptions, 'seed' | 'worldType' | 'spawn' | 'hostiles'>;

export interface RestoredWorld {
  readonly sim: Simulation;
  readonly info: WorldInfo;
  /**
   * The column records in storage, with the digest of their drops and block entities (for
   * snapshotSim).
   */
  readonly stored: Map<number, string>;
  /** Saved with another pack: every column record must be written again with this pack's ids. */
  readonly contentChanged: boolean;
}

/**
 * A migrated world record; throws when it cannot be a world (SaveVersionError when too new,
 * CorruptRecordError without a version, Error when malformed).
 */
function readWorld(data: WorldRecord): WorldRecord {
  const world = migrate('world', data as unknown as PlainRecord, data.saveVersion) as Partial<
    Record<keyof WorldRecord, unknown>
  >;
  const valid =
    typeof world.id === 'string' &&
    typeof world.seed === 'string' &&
    WORLD_TYPES.includes(world.worldType as WorldType) &&
    isWhole(world.tick, 0) &&
    isWhole(world.nextEntityId, 1) &&
    isPoint(world.spawn) &&
    insideWorld(world.spawn) &&
    Array.isArray(world.stateKeys) &&
    world.stateKeys.every((key) => typeof key === 'string');
  if (!valid) throw new Error('Corrupt world record');
  const record = world as WorldRecord;
  const date = (v: unknown) => (isFiniteNumber(v) ? v : 0);
  return {
    ...record,
    name: typeof record.name === 'string' ? record.name : '',
    createdAt: date(record.createdAt),
    savedAt: date(record.savedAt),
    rules: { hostiles: record.rules?.hostiles !== false },
  };
}

/** Saved state id → this pack's state id (keys the pack lacks become the unknown block). */
function stateRemap(stateKeys: readonly string[], registry: Registry): (id: number) => number {
  const table = stateKeys.map((key) => registry.stateIdOrUnknown(key));
  return (id) => table[id] ?? registry.unknownBlock;
}

/**
 * Puts a player record back into `entities`; an unusable record is logged and skipped (left in
 * storage): the player starts again at the spawn, and the rest of the world still loads.
 */
function restorePlayer(sim: Simulation, record: PlayerRecord, entities: Entity[]): void {
  try {
    const data = migrate('player', record as unknown as PlainRecord, record.v);
    const player = readPlayer(data, sim.registry, sim.spawn);
    if (!player) throw new RangeError('Bad player record');
    entities.push(player);
  } catch (error) {
    log.warn('unreadable player record skipped', {
      playerId: (record as Partial<PlayerRecord> | null)?.playerId,
      error: String(error),
    });
  }
}

/**
 * Puts a column record back: its sections into the edit store (they reach generation with the
 * column's next request), its drops and creatures into `entities`, its block entities into the
 * simulation (those lying outside the column are dropped), its herd flag. Returns the column key; undefined when the record is
 * unusable (logged and skipped, but left in storage: the rest of the world still loads).
 */
async function restoreColumn(
  sim: Simulation,
  record: ColumnRecord,
  remap: (id: number) => number,
  deflater: Deflater,
  entities: Entity[],
): Promise<number | undefined> {
  const { cx, cz } = record;
  try {
    if (!isWhole(cx, -Infinity) || !isWhole(cz, -Infinity))
      throw new RangeError('Bad column coordinates');
    if (!insideBorder(cx * SECTION_SIZE, cz * SECTION_SIZE))
      throw new RangeError('Column outside the world');
    const column = migrate('column', record as unknown as PlainRecord, record.v) as Partial<
      Record<keyof ColumnRecord, unknown>
    >;
    const { codec, payload } = column;
    if ((codec !== 'raw' && codec !== 'deflate-raw') || !(payload instanceof Uint8Array))
      throw new RangeError('Bad column payload');
    const raw = await expandPayload(codec, payload, deflater);
    const key = columnKey(cx, cz);
    const sections = unpackSections(raw, remap);
    if (sections.length > 0) sim.edits.put(key, sections);
    for (const data of Array.isArray(column.entities) ? column.entities : []) {
      const kind = (data as Partial<EntityRecord> | null)?.kind;
      const entity =
        kind === 'creature'
          ? readCreature(data, sim.registry, sim.tick)
          : readDrop(data, sim.registry);
      if (entity) entities.push(entity);
    }
    if (column.herds === true) sim.herdColumns.add(key);
    const lastTick = isWhole(column.lastTick, 0) ? column.lastTick : sim.tick;
    for (const data of Array.isArray(column.blockEntities) ? column.blockEntities : []) {
      const entity = readBlockEntity(data, sim.registry, lastTick);
      if (entity && toColumn(entity.x) === cx && toColumn(entity.z) === cz)
        sim.blockEntities.set(cellKey(entity.x, entity.y, entity.z), entity);
    }
    return key;
  } catch (error) {
    log.warn('unreadable column record skipped', { cx, cz, error: String(error) });
    return undefined;
  }
}

/** Adds restored entities in id order (the order they were created in), skipping duplicates. */
function addEntities(sim: Simulation, entities: Entity[], nextEntityId: number): void {
  entities.sort((a, b) => a.id - b.id);
  let next = nextEntityId;
  for (const entity of entities) {
    if (sim.entities.has(entity.id)) continue;
    if (entity.kind === 'player') {
      if (sim.players.has(entity.playerId)) continue;
      sim.join(entity);
    } else {
      sim.entities.set(entity.id, entity);
      sim.spatial.update(entity.id, entity.body.x, entity.body.z);
    }
    next = Math.max(next, entity.id + 1);
  }
  sim.nextEntityId = next;
}

/**
 * Rebuilds the simulation of a stored world (undefined when there is none), its records migrated
 * first. Throws SaveVersionError for a save newer than the game, another Error for a corrupt world
 * record; unreadable player and column records are skipped.
 * Nothing is loaded yet: the column source generates the columns around the players, the saved
 * sections laid over them, while the caller pumps the world.
 */
export async function restoreSim(
  storage: Storage,
  id: string,
  options: RestoreOptions,
  deflater: Deflater,
): Promise<RestoredWorld | undefined> {
  const stored = await storage.loadWorld(id);
  if (!stored) return undefined;
  const world = readWorld(stored.world);
  const sim = new Simulation({
    ...options,
    seed: world.seed,
    worldType: world.worldType,
    spawn: world.spawn,
    hostiles: world.rules.hostiles,
  });
  sim.tick = world.tick;
  Object.assign(sim.time, deserializeTime(world.time));
  const entities: Entity[] = [];
  for (const record of stored.players) restorePlayer(sim, record, entities);
  const remap = stateRemap(world.stateKeys, sim.registry);
  const keys: number[] = [];
  for (const record of stored.columns) {
    const key = await restoreColumn(sim, record, remap, deflater, entities);
    if (key !== undefined) keys.push(key);
  }
  addEntities(sim, entities, world.nextEntityId);
  // Digests of the records as stored, before the refunds below may drop items at a player's feet.
  const saved = entitiesByColumn(sim);
  const blockEntities = blockEntitiesByColumn(sim);
  const digests = keys.map((key): [number, string] => [
    key,
    columnDigest(saved.get(key), blockEntities.get(key), sim.herdColumns.has(key)),
  ]);
  // Queued recipes the pack no longer has give their ingredients back (« Clés inconnues »).
  const events: SimEvent[] = [];
  for (const player of sim.players.values()) refundUnknownCrafts(sim, player, events);
  return {
    sim,
    info: {
      id: world.id,
      name: world.name,
      createdAt: world.createdAt,
      savedAt: world.savedAt,
      rules: world.rules,
    },
    stored: new Map(digests),
    contentChanged: world.contentHash !== contentHash(sim.registry),
  };
}
