import { createLogger } from '../core/log.ts';
import type { HostMessage, WorkerMessage } from '../world/protocol.ts';

const log = createLogger('workers');

/** A request without an answer after this long is failed (later milestones restart the worker). */
export const WORKER_TIMEOUT_MS = 10_000;

/** Number of world workers: hardwareConcurrency − 2, between 1 and 4. */
export function workerCount(hardwareConcurrency: number): number {
  return Math.min(4, Math.max(1, (hardwareConcurrency || 4) - 2));
}

interface Pending {
  readonly workerIndex: number;
  readonly resolve: (message: WorkerMessage) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** Main-thread side of the world worker pool. */
export class WorkerPool {
  readonly size: number;
  private readonly workers: Worker[] = [];
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(size: number) {
    this.size = size;
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('../workers/world.worker.ts', import.meta.url), {
        type: 'module',
        name: 'world',
      });
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.onMessage(event.data);
      worker.onerror = (event) => {
        event.preventDefault();
        this.failWorker(i, `world worker ${i} failed: ${event.message || 'could not load'}`);
      };
      worker.onmessageerror = () =>
        this.failWorker(i, `world worker ${i} sent an unreadable message`);
      worker.postMessage({ type: 'init', workerIndex: i } satisfies HostMessage);
      this.workers.push(worker);
    }
  }

  /** Resolves with 'pong' once every worker has answered; rejects on error or timeout. */
  async ping(): Promise<'pong'> {
    if (this.workers.length === 0) throw new Error('The worker pool is empty');
    await Promise.all(this.workers.map((_, i) => this.request(i, (id) => ({ type: 'ping', id }))));
    return 'pong';
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('The worker pool was disposed'));
      this.pending.delete(id);
    }
  }

  private request(workerIndex: number, build: (id: number) => HostMessage): Promise<WorkerMessage> {
    const worker = this.workers[workerIndex]!;
    return new Promise<WorkerMessage>((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(
          `world worker ${workerIndex} did not answer within ${WORKER_TIMEOUT_MS} ms`,
        );
        log.error(error.message);
        reject(error);
      }, WORKER_TIMEOUT_MS);
      this.pending.set(id, { workerIndex, resolve, reject, timer });
      worker.postMessage(build(id));
    });
  }

  private failWorker(workerIndex: number, message: string): void {
    log.error(message);
    for (const [id, pending] of this.pending) {
      if (pending.workerIndex !== workerIndex) continue;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(new Error(message));
    }
  }

  private onMessage(message: WorkerMessage): void {
    if (message.type !== 'pong' && message.type !== 'error') return;
    const pending = this.pending.get(message.id);
    if (!pending) {
      if (message.type === 'error') log.error(`world worker error: ${message.message}`);
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.type === 'error') {
      log.error(`world worker ${pending.workerIndex}: ${message.message}`);
      pending.reject(new Error(message.message));
    } else {
      pending.resolve(message);
    }
  }
}
