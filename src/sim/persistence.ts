import type { Registry } from '../content/registry.ts';
import { fnv1aBytes, fnv1aString } from '../core/hash.ts';
import { persistedSections } from '../world/Column.ts';
import { compressPayload, type Deflater, packSections } from '../world/codec/columnRecord.ts';
import { SAVE_VERSION } from '../world/codec/migrations.ts';
import { blockToColumn, columnKey, columnKeyX, columnKeyZ, toColumn } from '../world/coords.ts';
import { GEN_VERSION } from '../world/gen/generateColumn.ts';
import type { SavedSection } from '../world/protocol.ts';
import { creatureDef, isGone, isHostile } from './creatures.ts';
import { playerRecord } from './playerRecords.ts';
import type { Entity, Simulation } from './Simulation.ts';
import { blockEntityRecord, creatureRecord, dropRecord } from './saveRecords.ts';
import { canonicalJson } from './stateHash.ts';
import type {
  BlockEntityRecord,
  ColumnRecord,
  EntityRecord,
  SaveBatch,
  WorldRecord,
  WorldRules,
} from './storage.ts';
import { serializeTime } from './time.ts';

/**
 * Persistence of a simulation (docs « Sauvegarde »): snapshots of its persistent state as store
 * records (rebuilt into a simulation by restore.ts, re-exported here). Persistent = world meta (seed, clock, entity ids,
 * spawn), players, and for each column its persisted sections, item drops, creatures (never the
 * hostile ones; parked with an unloaded column or not), block entities (chests, stations) and
 * whether it placed a herd. A restored world holds every saved creature; those of the columns not
 * loaded by its first tick leave with them (spawning.ts `departs`). Light, meshes,
 * untouched terrain and the streaming state are rebuilt: saved
 * sections go back to the edit store, and generation lays them over the terrain (the « Colonne déjà
 * modifiée » path).
 */

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
    blockUpdates: sim.blockUpdates.serialize(sim.tick),
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
export function entitiesByColumn(sim: Simulation): Map<number, EntityRecord[]> {
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
export function blockEntitiesByColumn(sim: Simulation): Map<number, BlockEntityRecord[]> {
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

export { type RestoredWorld, type RestoreOptions, restoreSim } from './restore.ts';
