import type { WorldType } from '../world/gen/generateColumn.ts';

/** Which world to generate. */
export interface WorldSpec {
  readonly seed: string;
  readonly worldType: WorldType;
}

/** Where generated columns come from (worker pool in the browser, inline generation under Node). */
export interface ColumnSource {
  /** Starts generating a column; the result is handed to `Simulation.deliver` later. */
  request(world: WorldSpec, cx: number, cz: number): void;
}
