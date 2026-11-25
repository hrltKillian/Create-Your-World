import { isWhole } from '../../core/guards.ts';

/**
 * Save versions (docs « Sauvegarde », « Versions »). Every stored record carries the version that
 * wrote it (`saveVersion` for worlds, `v` for players and columns). Bump SAVE_VERSION whenever the
 * save format changes and add the step that upgrades the previous version, with its fixture in
 * `tests/fixtures/saves/vN`. Worlds and players are migrated as soon as they are read, columns when
 * they are decoded; a save newer than the game is refused.
 */

export const SAVE_VERSION = 8;

export type RecordKind = 'world' | 'player' | 'column';

/** A stored record as plain data (structured clone or JSON). */
export type PlainRecord = Readonly<Record<string, unknown>>;

/** Upgrades each kind of record from one version to the next. */
export type MigrationStep = Readonly<Record<RecordKind, (record: PlainRecord) => PlainRecord>>;

/** A column record whose block entities go through `upgrade` (a list that is no list is kept). */
function withBlockEntities(
  record: PlainRecord,
  upgrade: (entity: unknown) => unknown,
): PlainRecord {
  const entities = record.blockEntities;
  return { ...record, blockEntities: Array.isArray(entities) ? entities.map(upgrade) : entities };
}

/** A block entity record's kind, if it is an object. */
const kindOf = (entity: unknown): unknown => (entity as { kind?: unknown } | null)?.kind;

/** `MIGRATIONS[i]` upgrades a version i + 1 record to version i + 2. */
export const MIGRATIONS: readonly MigrationStep[] = [
  // 1 → 2 (M8): players keep a craft queue and the items they have seen, columns block entities.
  {
    world: (record) => record,
    player: (record) => ({ ...record, craft: [], seen: [] }),
    column: (record) => ({ ...record, blockEntities: [] }),
  },
  // 2 → 3 (M9): players wear equipment, may have a bedroll to respawn at, graves and objectives;
  // their survival state is left out, which reads as full gauges.
  {
    world: (record) => record,
    player: (record) => ({ ...record, equipment: [], respawn: null, graves: [], objectives: [] }),
    column: (record) => record,
  },
  // 3 → 4 (M9 review): players remember having drunk (objectives) and whether their last death
  // left a pack (`survival.packLeft`, read as false when absent); an Abandoned Pack keeps the worn
  // items apart, so an older one's are all among its slots and none is worn.
  {
    world: (record) => record,
    player: (record) => ({ ...record, drank: false }),
    column: (record) =>
      withBlockEntities(record, (entity) =>
        kindOf(entity) === 'grave' ? { ...(entity as object), worn: [] } : entity,
      ),
  },
  // 4 → 5 (M10): columns keep their creatures among their entities, and whether their first
  // generation placed a herd. A stored column had its first generation long ago (it was edited or
  // held items since): it counts as having had its herd, so none lands on the player's builds.
  {
    world: (record) => record,
    player: (record) => record,
    column: (record) => ({ ...record, herds: true }),
  },
  // 5 → 6 (M12): a fire burns only while it processes, unless the player keeps it burning; a
  // station burning when saved keeps burning (the reader keeps the toggle for campfires only).
  {
    world: (record) => record,
    player: (record) => record,
    column: (record) =>
      withBlockEntities(record, (entity) =>
        kindOf(entity) === 'station'
          ? { ...(entity as object), keepLit: (entity as { lit?: unknown }).lit === true }
          : entity,
      ),
  },
  // 6 → 7 (M13): players hold a cursor stack while a screen is open, none in an older save (its
  // inventory of 32 slots keeps its length: the slot numbers of commands are never saved). A
  // workbench keeps its own queue and outputs in a block entity: an older save has none (one is
  // made when it is first opened), and the workbench recipes it queued in a player's own queue
  // finish there, as they did.
  {
    world: (record) => record,
    player: (record) => ({ ...record, cursor: null }),
    column: (record) => record,
  },
  // 7 → 8 (M14): the world keeps its block updates (supports, leaf decay) due or waiting; an
  // older world had none. Its state keys still read as before (registry `resolveKey`: a torch is on
  // the floor, leaves are not a player's).
  {
    world: (record) => ({ ...record, blockUpdates: [] }),
    player: (record) => record,
    column: (record) => record,
  },
];

/** A save made by a newer version of the game, which this one cannot read. */
export class SaveVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveVersionError';
  }
}

/** A stored record that cannot be a save at all (no valid version): damaged, or not ours. */
export class CorruptRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorruptRecordError';
  }
}

/**
 * Brings a record of `version` up to the last version of `steps` (SAVE_VERSION for the game's own
 * table), one step at a time. Throws SaveVersionError for a newer record, CorruptRecordError for a
 * record without a valid version.
 */
export function migrate(
  kind: RecordKind,
  record: PlainRecord,
  version: unknown,
  steps: readonly MigrationStep[] = MIGRATIONS,
): PlainRecord {
  const latest = steps.length + 1;
  if (!isWhole(version, 1))
    throw new CorruptRecordError(`The ${kind} record has no valid save version`);
  if (version > latest)
    throw new SaveVersionError(`The ${kind} record was saved by a newer version (${version})`);
  let out = record;
  for (let v = version; v < latest; v++) out = steps[v - 1]![kind](out);
  return out;
}
