/**
 * Save versions (docs « Sauvegarde », « Versions »). Every stored record carries the version that
 * wrote it (`saveVersion` for worlds, `v` for players and columns). Bump SAVE_VERSION whenever the
 * save format changes and add the step that upgrades the previous version, with its fixture in
 * `tests/fixtures/saves/vN`. Worlds and players are migrated as soon as they are read, columns when
 * they are decoded; a save newer than the game is refused.
 */

export const SAVE_VERSION = 1;

export type RecordKind = 'world' | 'player' | 'column';

/** A stored record as plain data (structured clone or JSON). */
export type PlainRecord = Readonly<Record<string, unknown>>;

/** Upgrades each kind of record from one version to the next. */
export type MigrationStep = Readonly<Record<RecordKind, (record: PlainRecord) => PlainRecord>>;

/** `MIGRATIONS[i]` upgrades a version i + 1 record to version i + 2 (none yet: 1 is the first). */
export const MIGRATIONS: readonly MigrationStep[] = [];

/** A save this game cannot read: made by a newer version, or without a valid version. */
export class SaveVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveVersionError';
  }
}

/**
 * Brings a record of `version` up to the last version of `steps` (SAVE_VERSION for the game's own
 * table), one step at a time.
 */
export function migrate(
  kind: RecordKind,
  record: PlainRecord,
  version: unknown,
  steps: readonly MigrationStep[] = MIGRATIONS,
): PlainRecord {
  const latest = steps.length + 1;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    throw new SaveVersionError(`The ${kind} record has no valid save version`);
  if (version > latest)
    throw new SaveVersionError(`The ${kind} record was saved by a newer version (${version})`);
  let out = record;
  for (let v = version; v < latest; v++) out = steps[v - 1]![kind](out);
  return out;
}
