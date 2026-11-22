/**
 * Messages exchanged between the main thread and world workers.
 * Shared by `platform/WorkerPool` (main thread) and `workers/runtime` (worker side).
 */

/** Transport used by worker-side code; bound to `self` only inside `*.worker.ts` entries. */
export interface WorkerPort {
  post(message: WorkerMessage, transfer?: ArrayBuffer[]): void;
  listen(handler: (message: HostMessage) => void): void;
}

export type HostMessage = { type: 'init'; workerIndex: number } | { type: 'ping'; id: number };

export type WorkerMessage =
  | { type: 'ready'; workerIndex: number }
  | { type: 'pong'; id: number; workerIndex: number }
  | { type: 'error'; id: number; message: string };
