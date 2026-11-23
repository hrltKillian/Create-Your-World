/** The simulation's fixed rate: every rule counts in ticks of 1/30 s. */
export const TICKS_PER_SECOND = 30;
export const TICK_SECONDS = 1 / TICKS_PER_SECOND;

/** Ticks of a duration given in seconds in the data (recipes, processes, fuels): at least 1. */
export function ticksOf(seconds: number): number {
  return Math.max(1, Math.round(seconds * TICKS_PER_SECOND));
}
