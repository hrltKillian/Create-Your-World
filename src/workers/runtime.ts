import type { HostMessage, JobPriority, WorkerPort } from '../world/protocol.ts';
import { resultTransfers } from '../world/protocol.ts';
import { WorldJobs } from './worldJobs.ts';

interface QueuedJob {
  readonly message: Extract<HostMessage, { type: 'job' }>;
}

export interface RuntimeOptions {
  /** Schedules the next job; defaults to a MessageChannel post so new messages are read in between. */
  readonly schedule?: (run: () => void) => void;
  readonly now?: () => number;
}

function defaultSchedule(): (run: () => void) => void {
  const channel = new MessageChannel();
  let pending: (() => void) | null = null;
  channel.port1.onmessage = () => {
    const run = pending;
    pending = null;
    run?.();
  };
  return (run) => {
    pending = run;
    channel.port2.postMessage(0);
  };
}

/**
 * Worker-side runtime. Pure module: it only talks to the injected port, so it runs the same way
 * inside a Web Worker, in Node (tools/headless.ts) and in unit tests. Jobs run one at a time from
 * two queues; after each job the runtime yields, so an urgent job that arrived meanwhile goes next.
 */
export function startWorldWorker(port: WorkerPort, options: RuntimeOptions = {}): void {
  let workerIndex = -1;
  let jobs: WorldJobs | null = null;
  const queues: Record<JobPriority, QueuedJob[]> = { urgent: [], normal: [] };
  const schedule = options.schedule ?? defaultSchedule();
  let scheduled = false;

  const runNext = () => {
    scheduled = false;
    const next = queues.urgent.shift() ?? queues.normal.shift();
    if (!next) return;
    const { id, job } = next.message;
    try {
      jobs ??= new WorldJobs(undefined, options.now);
      const result = jobs.run(job);
      port.post({ type: 'result', id, result }, resultTransfers(result));
    } catch (error) {
      port.post({
        type: 'error',
        id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (queues.urgent.length > 0 || queues.normal.length > 0) kick();
  };

  const kick = () => {
    if (scheduled) return;
    scheduled = true;
    schedule(runNext);
  };

  port.listen((message: HostMessage) => {
    try {
      switch (message.type) {
        case 'init':
          workerIndex = message.workerIndex;
          port.post({ type: 'ready', workerIndex });
          break;
        case 'ping':
          port.post({ type: 'pong', id: message.id, workerIndex });
          break;
        case 'job':
          queues[message.priority].push({ message });
          kick();
          break;
      }
    } catch (error) {
      const id = 'id' in message ? message.id : -1;
      port.post({
        type: 'error',
        id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
