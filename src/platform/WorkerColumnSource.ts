import type { ColumnSource } from '../sim/ports.ts';
import type { Simulation } from '../sim/Simulation.ts';
import type { WorkerPool } from './WorkerPool.ts';

/** Column source backed by the world worker pool. */
export class WorkerColumnSource implements ColumnSource {
  private readonly pool: WorkerPool;
  private sim: Simulation | null = null;

  constructor(pool: WorkerPool) {
    this.pool = pool;
  }

  connect(sim: Simulation): void {
    this.sim = sim;
  }

  request(seed: string, cx: number, cz: number): void {
    this.pool.run({ kind: 'gen', seed, cx, cz }, 'normal').then(
      (result) => this.sim?.deliver(result),
      () => this.sim?.requestFailed(cx, cz),
    );
  }
}
