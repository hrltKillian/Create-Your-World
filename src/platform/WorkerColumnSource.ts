import type { ColumnSink, ColumnSource, WorldSpec } from '../sim/ports.ts';
import type { WorkerPool } from './WorkerPool.ts';

/** Column source backed by the world worker pool. */
export class WorkerColumnSource implements ColumnSource {
  private readonly pool: WorkerPool;
  private sink: ColumnSink | null = null;

  constructor(pool: WorkerPool) {
    this.pool = pool;
  }

  connect(sink: ColumnSink): void {
    this.sink = sink;
  }

  request(world: WorldSpec, cx: number, cz: number): void {
    this.pool
      .run({ kind: 'gen', seed: world.seed, worldType: world.worldType, cx, cz }, 'normal')
      .then(
        (result) => this.sink?.deliver(result),
        () => this.sink?.requestFailed(cx, cz),
      );
  }
}
