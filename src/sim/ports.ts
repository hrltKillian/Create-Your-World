/** Where generated columns come from (worker pool in the browser, inline generation under Node). */
export interface ColumnSource {
  /** Starts generating a column; the result is handed to `Simulation.deliver` later. */
  request(seed: string, cx: number, cz: number): void;
}
