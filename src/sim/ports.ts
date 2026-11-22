import type { WorldType } from '../world/gen/generateColumn.ts';
import type { GenResult } from '../world/protocol.ts';

/** Which world to generate. */
export interface WorldSpec {
  readonly seed: string;
  readonly worldType: WorldType;
}

/** Receives what a column source produces (the simulation). */
export interface ColumnSink {
  /** A generated column arrives (any order, any time). */
  deliver(result: GenResult): void;
  /** A generation request failed: it may be asked again. */
  requestFailed(cx: number, cz: number): void;
}

/** Where generated columns come from (worker pool in the browser, inline generation under Node). */
export interface ColumnSource {
  /** Called once by the simulation the source feeds. */
  connect(sink: ColumnSink): void;
  /** Starts generating a column; the result is handed to the sink later. */
  request(world: WorldSpec, cx: number, cz: number): void;
}
