import type { ColumnRecord, PlayerRecord, Storage, WorldRecord } from '../sim/storage.ts';
import { migrate, type PlainRecord } from '../world/codec/migrations.ts';

/**
 * Export and import of a world (docs « Sauvegarde »: a copy kept outside the browser): every record
 * as stored, column payloads in base64, in gzip'd JSON. Records keep their save version: they are
 * migrated when the world is loaded, like any other save.
 */

const FORMAT = 'create-your-world/world';

type ExportedColumn = Omit<ColumnRecord, 'payload'> & { readonly payload: string };

interface ExportFile {
  readonly format: typeof FORMAT;
  readonly world: WorldRecord;
  readonly players: readonly PlayerRecord[];
  readonly columns: readonly ExportedColumn[];
}

/** Runs bytes through a compression stream (as io.worker's deflater does, with gzip here). */
async function through(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let text = '';
  // Chunks keep the argument list of fromCharCode short.
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function fromBase64(base64: string): Uint8Array {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** The export file of a stored world (gzip bytes). */
export async function exportWorld(storage: Storage, worldId: string): Promise<Uint8Array> {
  const stored = await storage.loadWorld(worldId);
  if (!stored) throw new Error(`No world ${worldId} to export`);
  const file: ExportFile = {
    format: FORMAT,
    world: stored.world,
    players: stored.players,
    columns: stored.columns.map((column) => ({ ...column, payload: toBase64(column.payload) })),
  };
  return through(new TextEncoder().encode(JSON.stringify(file)), new CompressionStream('gzip'));
}

/**
 * Stores the world of an export file as world `worldId`, replacing any world with that id, and
 * returns its record. Throws on a file that is not a world export, and SaveVersionError for a world
 * saved by a newer game.
 */
export async function importWorld(
  storage: Storage,
  bytes: Uint8Array,
  worldId: string,
): Promise<WorldRecord> {
  const json = new TextDecoder().decode(await through(bytes, new DecompressionStream('gzip')));
  const file = JSON.parse(json) as Partial<ExportFile> | null;
  const valid =
    file?.format === FORMAT &&
    typeof file.world === 'object' &&
    file.world !== null &&
    Array.isArray(file.players) &&
    Array.isArray(file.columns) &&
    file.columns.every((column) => typeof column?.payload === 'string');
  if (!valid) throw new Error('This file is not a world export');
  const { world: saved, players, columns } = file as ExportFile;
  migrate('world', saved as unknown as PlainRecord, saved.saveVersion);
  const world = { ...saved, id: worldId };
  await storage.deleteWorld(worldId);
  await storage.write({
    world,
    players: players.map((player) => ({ ...player, worldId })),
    columns: columns.map((column) => ({ ...column, worldId, payload: fromBase64(column.payload) })),
    removed: [],
  });
  return world;
}
