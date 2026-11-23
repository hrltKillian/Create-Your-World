/**
 * Messages between platform/IdbStorage (main thread) and io.worker (docs « Workers », « Sauvegarde »).
 * The worker keeps records as values and only reads their keys; their full shapes live in
 * sim/storage.ts, which the worker layer cannot import.
 */

/** Store `worlds`, key `id`. */
export interface IoWorld {
  readonly id: string;
}

/** Store `players`, key `[worldId, playerId]`. */
export interface IoPlayer {
  readonly worldId: string;
  readonly playerId: number;
}

/** Store `columns`, key `[worldId, cx, cz]`. */
export interface IoColumn {
  readonly worldId: string;
  readonly cx: number;
  readonly cz: number;
  readonly payload: Uint8Array;
}

/** A world with all its records. */
export interface IoWorldRecords {
  readonly world: IoWorld;
  readonly players: readonly IoPlayer[];
  readonly columns: readonly IoColumn[];
}

/** One save: records to add or replace and columns to delete, in a single transaction. */
export interface IoBatch extends IoWorldRecords {
  readonly removed: readonly { readonly cx: number; readonly cz: number }[];
}

/** Records of one world in each store (a deleted world has none). */
export interface StoreCounts {
  readonly worlds: number;
  readonly players: number;
  readonly columns: number;
}

export type IoCall =
  /** Opens the database (answers an error when IndexedDB cannot be used). */
  | { readonly op: 'open' }
  | { readonly op: 'listWorlds' }
  | { readonly op: 'loadWorld'; readonly worldId: string }
  | { readonly op: 'write'; readonly batch: IoBatch }
  | { readonly op: 'deleteWorld'; readonly worldId: string }
  | { readonly op: 'inspect'; readonly worldId: string }
  | { readonly op: 'getKv'; readonly key: string }
  | { readonly op: 'setKv'; readonly key: string; readonly value: unknown }
  | { readonly op: 'deflate'; readonly bytes: Uint8Array }
  | { readonly op: 'inflate'; readonly bytes: Uint8Array };

export type IoRequest = IoCall & { readonly id: number };

/** The answer to request `id`: its value, or the error it threw (name kept: QuotaExceededError). */
export type IoReply =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly name: string; readonly message: string };

/** The worker side of the io channel (`self` in io.worker, a fake in tests). */
export interface IoPort {
  post(message: IoReply, transfer?: ArrayBuffer[]): void;
  listen(handler: (message: IoRequest) => void): void;
}

/**
 * Buffers to transfer with some byte arrays, each once. Only exact-size copies are transferred,
 * never a view into a larger buffer (that one is copied by the structured clone instead).
 */
export function byteTransfers(arrays: Iterable<Uint8Array>): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const bytes of arrays) {
    const buffer = bytes.buffer;
    if (
      buffer instanceof ArrayBuffer &&
      bytes.byteOffset === 0 &&
      bytes.byteLength === buffer.byteLength
    )
      out.add(buffer);
  }
  return [...out];
}

/** The column payloads of some records, for `byteTransfers`. */
export function payloads(columns: readonly IoColumn[]): Uint8Array[] {
  return columns.map((column) => column.payload);
}
