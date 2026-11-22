import type { HostMessage, WorkerMessage } from '../world/protocol.ts';

/** Number of world workers: hardwareConcurrency − 2, between 1 and 4. */
export function workerCount(hardwareConcurrency: number): number {
  return Math.min(4, Math.max(1, (hardwareConcurrency || 4) - 2));
}

/** Main-thread side of the world worker pool. */
export class WorkerPool {
  readonly size: number;
  private readonly workers: Worker[] = [];
  private readonly pending = new Map<number, (message: WorkerMessage) => void>();
  private nextId = 1;

  constructor(size: number) {
    this.size = size;
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('../workers/world.worker.ts', import.meta.url), {
        type: 'module',
        name: 'world',
      });
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.onMessage(event.data);
      this.post(worker, { type: 'init', workerIndex: i });
      this.workers.push(worker);
    }
  }

  /** Resolves with 'pong' once every worker has answered. */
  async ping(): Promise<'pong'> {
    await Promise.all(
      this.workers.map(
        (worker) =>
          new Promise<WorkerMessage>((resolve) => {
            const id = this.nextId++;
            this.pending.set(id, resolve);
            this.post(worker, { type: 'ping', id });
          }),
      ),
    );
    return 'pong';
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    this.pending.clear();
  }

  private post(worker: Worker, message: HostMessage): void {
    worker.postMessage(message);
  }

  private onMessage(message: WorkerMessage): void {
    if (message.type === 'pong' || message.type === 'error') {
      const resolve = this.pending.get(message.id);
      if (resolve) {
        this.pending.delete(message.id);
        resolve(message);
      }
    }
  }
}
