/** Most time (ms) between two presses of forward for a double tap. */
export const DOUBLE_TAP_MS = 300;

/**
 * Double-tap sprint (docs « M12 »): forward pressed again within `DOUBLE_TAP_MS` of its previous
 * press latches sprint, for as long as forward stays held (the caller checks that); any later
 * press decides again. Pure: the times are the caller's (the key events' time stamps), so tests
 * run on fake times.
 */
export class SprintLatch {
  /** Sprint latched by the last press of forward. */
  on = false;
  /** Time of the last press of forward (ms). */
  private last = Number.NEGATIVE_INFINITY;

  /** Forward pressed at `time` (ms). */
  press(time: number): void {
    this.on = time - this.last <= DOUBLE_TAP_MS;
    this.last = time;
  }

  /** Forgets the last press (keys released: a screen opened, the focus lost). */
  forget(): void {
    this.on = false;
    this.last = Number.NEGATIVE_INFINITY;
  }
}
