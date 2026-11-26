import type { Registry } from '../content/registry.ts';
import { isFiniteNumber, isPoint, isWhole } from '../core/guards.ts';
import { createLogger } from '../core/log.ts';
import { type Deflater, expandPayload, unpackSections } from '../world/codec/columnRecord.ts';
import { migrate, type PlainRecord } from '../world/codec/migrations.ts';
import { cellKey, columnKey, insideBorder, SECTION_SIZE, toColumn } from '../world/coords.ts';
import { WORLD_TYPES, type WorldType } from '../world/gen/generateColumn.ts';
import { refundUnknownCrafts } from './craftQueue.ts';
import type { SimEvent } from './events.ts';
import { fitStacks } from './inventory.ts';
import { giveItems } from './inventoryCommands.ts';
import { spawnDrop } from './itemDrops.ts';
import {
  blockEntitiesByColumn,
  columnDigest,
  contentHash,
  entitiesByColumn,
  type WorldInfo,
} from './persistence.ts';
import { readPlayer } from './playerRecords.ts';
import { type Entity, type SimOptions, Simulation } from './Simulation.ts';
import { insideWorld, readBlockEntity, readCreature, readDrop } from './saveRecords.ts';
import { stowCursor } from './screens.ts';
import type { ColumnRecord, EntityRecord, PlayerRecord, Storage, WorldRecord } from './storage.ts';
import { deserializeTime } from './time.ts';

/**
 * A simulation rebuilt from its store records (docs « Sauvegarde », persistence.ts's snapshots):
 * the world record migrated and checked, the players, then each stored column's sections, item
 * drops, creatures and block entities; saved state ids remapped to this pack's when it changed.
 */

const log = createLogger('restore');

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
 * Stacks over a maximum the pack lowered since the save are cut down to it (`fitStacks`): a
 * player's excess goes into their inventory (at their feet when it is full), a block entity's
 * drops on its block. A player's cursor stack, saved while a screen was open, goes back to the
 * inventory first (no screen is open after a restore).
 */
function fitRestoredStacks(sim: Simulation, events: SimEvent[]): void {
  const registry = sim.registry;
  for (const player of sim.players.values()) {
    stowCursor(sim, player, events);
    const excess = [
      ...fitStacks(registry, player.inventory),
      ...fitStacks(registry, player.equipment),
    ];
    for (const stack of excess) giveItems(sim, player, stack, events);
  }
  for (const entity of sim.blockEntities.values()) {
    const excess = fitStacks(registry, entity.slots);
    if (entity.kind === 'grave') excess.push(...fitStacks(registry, entity.worn));
    for (const stack of excess)
      spawnDrop(sim, stack, entity.x + 0.5, entity.y + 0.5, entity.z + 0.5);
  }
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
  if (Array.isArray(world.blockUpdates)) sim.blockUpdates.restore(world.blockUpdates, sim.tick);
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
  fitRestoredStacks(sim, events);
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
