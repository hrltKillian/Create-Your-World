/**
 * Messages and job types exchanged between the main thread and world workers. Shared by
 * `platform/WorkerPool` (main thread), `workers/runtime` (worker side) and the pure job handlers.
 */

/** Transport used by worker-side code; bound to `self` only inside `*.worker.ts` entries. */
export interface WorkerPort {
  post(message: WorkerMessage, transfer?: ArrayBuffer[]): void;
  listen(handler: (message: HostMessage) => void): void;
}

export type JobPriority = 'urgent' | 'normal';

/** Generate one column of terrain. */
export interface GenJob {
  readonly kind: 'gen';
  readonly seed: string;
  readonly cx: number;
  readonly cz: number;
}

/** Mesh one section from its padded copy (34³ ids and light, 34² biomes). */
export interface MeshJob {
  readonly kind: 'mesh';
  readonly key: number;
  readonly version: number;
  readonly ids: Uint16Array;
  readonly light: Uint8Array;
  readonly biomes: Uint8Array;
}

export interface SectionPayload {
  readonly sy: number;
  readonly uniformBlock: number;
  readonly blocks: Uint16Array | null;
  readonly uniformLight: number;
  readonly light: Uint8Array | null;
}

export interface GenResult {
  readonly kind: 'gen';
  readonly seed: string;
  readonly cx: number;
  readonly cz: number;
  readonly sections: readonly SectionPayload[];
  readonly heightmap: Int16Array;
  readonly biomes: Uint8Array;
  /** Generation time inside the worker (ms). */
  readonly ms: number;
}

export interface PassPayload {
  readonly data: Uint32Array;
  readonly quads: number;
}

export interface MeshResult {
  readonly kind: 'mesh';
  readonly key: number;
  readonly version: number;
  readonly passes: readonly [PassPayload, PassPayload, PassPayload];
  readonly connectivity: number;
  readonly ms: number;
}

export type Job = GenJob | MeshJob;
export type JobResult = GenResult | MeshResult;

export type HostMessage =
  | { readonly type: 'init'; readonly workerIndex: number }
  | { readonly type: 'ping'; readonly id: number }
  | {
      readonly type: 'job';
      readonly id: number;
      readonly priority: JobPriority;
      readonly job: Job;
    };

export type WorkerMessage =
  | { readonly type: 'ready'; readonly workerIndex: number }
  | { readonly type: 'pong'; readonly id: number; readonly workerIndex: number }
  | { readonly type: 'result'; readonly id: number; readonly result: JobResult }
  | { readonly type: 'error'; readonly id: number; readonly message: string };

/** Runs jobs somewhere (worker pool in the browser, synchronously under Node). */
export interface JobRunner {
  run(job: GenJob, priority?: JobPriority): Promise<GenResult>;
  run(job: MeshJob, priority?: JobPriority): Promise<MeshResult>;
}

/** Buffers a job hands over to the worker (transferred, not copied). */
export function jobTransfers(job: Job): ArrayBuffer[] {
  return job.kind === 'mesh'
    ? ([job.ids.buffer, job.light.buffer, job.biomes.buffer] as ArrayBuffer[])
    : [];
}

/** Buffers a result hands back to the main thread. */
export function resultTransfers(result: JobResult): ArrayBuffer[] {
  if (result.kind === 'mesh') return result.passes.map((p) => p.data.buffer as ArrayBuffer);
  const out: ArrayBuffer[] = [
    result.heightmap.buffer as ArrayBuffer,
    result.biomes.buffer as ArrayBuffer,
  ];
  for (const s of result.sections) {
    if (s.blocks) out.push(s.blocks.buffer as ArrayBuffer);
    if (s.light) out.push(s.light.buffer as ArrayBuffer);
  }
  return out;
}
