import { createLogger } from '../core/log.ts';
import {
  type GenJob,
  type GenResult,
  type HostMessage,
  type Job,
  type JobPriority,
  type JobResult,
  type JobRunner,
  jobTransfers,
  type MeshJob,
  type MeshResult,
  type WorkerMessage,
} from '../world/protocol.ts';

const log = createLogger('workers');

/** A request without an answer after this long fails and its worker is restarted. */
export const WORKER_TIMEOUT_MS = 10_000;
/** Normal-priority jobs in flight per worker (urgent jobs are never held back). */
const NORMAL_IN_FLIGHT = 2;

/** Number of world workers: hardwareConcurrency − 2, between 1 and 4. */
export function workerCount(hardwareConcurrency: number): number {
  return Math.min(4, Math.max(1, (hardwareConcurrency || 4) - 2));
}

interface Task {
  readonly id: number;
  readonly message: HostMessage;
  readonly transfer: ArrayBuffer[];
  readonly priority: JobPriority;
  readonly resolve: (message: WorkerMessage) => void;
  readonly reject: (error: Error) => void;
  worker: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export interface PoolStats {
  readonly workers: number;
  readonly queued: number;
  readonly inFlight: number;
  readonly done: Readonly<Record<'gen' | 'mesh', number>>;
  /** Mean worker-side time of the last 64 jobs of each kind (ms). */
  readonly meanMs: Readonly<Record<'gen' | 'mesh', number>>;
  readonly restarts: number;
}

/** Main-thread side of the world worker pool; implements the JobRunner port. */
export class WorkerPool implements JobRunner {
  readonly size: number;
  private readonly workers: Worker[] = [];
  private readonly normalInFlight: number[] = [];
  private readonly totalInFlight: number[] = [];
  private readonly tasks = new Map<number, Task>();
  private readonly queue: Task[] = [];
  private nextId = 1;
  private restarts = 0;
  private readonly done = { gen: 0, mesh: 0 };
  private readonly timings = { gen: [] as number[], mesh: [] as number[] };

  constructor(size: number) {
    this.size = size;
    for (let i = 0; i < size; i++) {
      this.workers.push(this.spawn(i));
      this.normalInFlight.push(0);
      this.totalInFlight.push(0);
    }
  }

  run(job: GenJob, priority?: JobPriority): Promise<GenResult>;
  run(job: MeshJob, priority?: JobPriority): Promise<MeshResult>;
  run(job: Job, priority: JobPriority = 'normal'): Promise<JobResult> {
    return new Promise<WorkerMessage>((resolve, reject) => {
      const id = this.nextId++;
      const task: Task = {
        id,
        message: { type: 'job', id, priority, job },
        transfer: jobTransfers(job),
        priority,
        resolve,
        reject,
        worker: -1,
        timer: undefined,
      };
      this.tasks.set(id, task);
      if (priority === 'urgent') this.send(task, this.leastLoaded(false));
      else {
        this.queue.push(task);
        this.dispatch();
      }
    }).then((message) => {
      if (message.type !== 'result') throw new Error('Unexpected worker reply');
      const result = message.result;
      this.done[result.kind]++;
      const list = this.timings[result.kind];
      list.push(result.ms);
      if (list.length > 64) list.shift();
      return result;
    });
  }

  /** Resolves with 'pong' once every worker has answered; rejects on error or timeout. */
  async ping(): Promise<'pong'> {
    if (this.workers.length === 0) throw new Error('The worker pool is empty');
    await Promise.all(
      this.workers.map(
        (_, i) =>
          new Promise<WorkerMessage>((resolve, reject) => {
            const id = this.nextId++;
            const task: Task = {
              id,
              message: { type: 'ping', id },
              transfer: [],
              priority: 'urgent',
              resolve,
              reject,
              worker: -1,
              timer: undefined,
            };
            this.tasks.set(id, task);
            this.send(task, i);
          }),
      ),
    );
    return 'pong';
  }

  stats(): PoolStats {
    const mean = (list: number[]) =>
      list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
    return {
      workers: this.workers.length,
      queued: this.queue.length,
      inFlight: this.totalInFlight.reduce((a, b) => a + b, 0),
      done: { ...this.done },
      meanMs: { gen: mean(this.timings.gen), mesh: mean(this.timings.mesh) },
      restarts: this.restarts,
    };
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    for (const task of this.tasks.values()) {
      clearTimeout(task.timer);
      task.reject(new Error('The worker pool was disposed'));
    }
    this.tasks.clear();
    this.queue.length = 0;
  }

  private spawn(index: number): Worker {
    const worker = new Worker(new URL('../workers/world.worker.ts', import.meta.url), {
      type: 'module',
      name: 'world',
    });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.onMessage(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      this.restart(index, `world worker ${index} failed: ${event.message || 'could not load'}`);
    };
    worker.onmessageerror = () =>
      this.restart(index, `world worker ${index} sent an unreadable message`);
    worker.postMessage({ type: 'init', workerIndex: index } satisfies HostMessage);
    return worker;
  }

  private leastLoaded(normalOnly: boolean): number {
    let best = -1;
    for (let i = 0; i < this.workers.length; i++) {
      if (normalOnly && this.normalInFlight[i]! >= NORMAL_IN_FLIGHT) continue;
      if (best < 0 || this.totalInFlight[i]! < this.totalInFlight[best]!) best = i;
    }
    return best;
  }

  private dispatch(): void {
    while (this.queue.length > 0) {
      const index = this.leastLoaded(true);
      if (index < 0) return;
      this.send(this.queue.shift()!, index);
    }
  }

  private send(task: Task, index: number): void {
    task.worker = index;
    this.totalInFlight[index]!++;
    if (task.priority === 'normal') this.normalInFlight[index]!++;
    task.timer = setTimeout(
      () =>
        this.restart(index, `world worker ${index} did not answer within ${WORKER_TIMEOUT_MS} ms`),
      WORKER_TIMEOUT_MS,
    );
    this.workers[index]!.postMessage(task.message, task.transfer);
  }

  private settle(task: Task): void {
    clearTimeout(task.timer);
    this.tasks.delete(task.id);
    if (task.worker >= 0) {
      this.totalInFlight[task.worker]!--;
      if (task.priority === 'normal') this.normalInFlight[task.worker]!--;
    }
  }

  /** Fails the worker's in-flight tasks (callers retry; transferred buffers cannot be resent). */
  private restart(index: number, reason: string): void {
    log.error(reason);
    this.restarts++;
    for (const task of [...this.tasks.values()]) {
      if (task.worker !== index) continue;
      this.settle(task);
      task.reject(new Error(reason));
    }
    this.workers[index]?.terminate();
    this.workers[index] = this.spawn(index);
    this.dispatch();
  }

  private onMessage(message: WorkerMessage): void {
    if (message.type === 'ready') return;
    const task = this.tasks.get(message.id);
    if (!task) {
      if (message.type === 'error') log.error(`world worker error: ${message.message}`);
      return;
    }
    this.settle(task);
    if (message.type === 'error') {
      log.error(`world worker ${task.worker}: ${message.message}`);
      task.reject(new Error(message.message));
    } else {
      task.resolve(message);
    }
    this.dispatch();
  }
}
