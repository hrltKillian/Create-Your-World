/**
 * Pointer Lock with the quirks handled: the request may return a promise or undefined, the raw
 * (unadjusted) mode is tried first, the first movement after locking and implausible jumps are
 * dropped, and an unexpected unlock is reported (the game pauses). The `pointerlockerror` of a
 * refused unadjusted request is not: the plain retry already runs (a browser rejects the promise,
 * a microtask, before it fires the event, a task).
 */
export class PointerLock {
  private readonly element: HTMLElement;
  private locked = false;
  private skipNext = false;
  /** The unadjusted request was refused: its `pointerlockerror` is still to come, and ignored. */
  private rawRefused = false;
  onChange: ((locked: boolean) => void) | null = null;

  constructor(element: HTMLElement) {
    this.element = element;
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', this.onLockError);
  }

  isLocked(): boolean {
    return this.locked;
  }

  /** Must be called from a user gesture (click). */
  request(): void {
    if (this.locked) return;
    this.rawRefused = false;
    const element = this.element as HTMLElement & {
      requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | undefined;
    };
    try {
      const attempt = element.requestPointerLock({ unadjustedMovement: true });
      if (attempt && typeof attempt.then === 'function') {
        attempt.catch(() => {
          // Raw input unsupported or refused: try the plain mode.
          this.rawRefused = true;
          const retry = element.requestPointerLock();
          retry?.catch(() => {});
        });
      }
    } catch {
      element.requestPointerLock();
    }
  }

  exit(): void {
    if (document.pointerLockElement === this.element) document.exitPointerLock();
  }

  /** Filters a mouse movement: drops the first one after locking and jumps over 400 px. */
  accept(dx: number, dy: number): boolean {
    if (!this.locked) return false;
    if (this.skipNext) {
      this.skipNext = false;
      return false;
    }
    return Math.abs(dx) <= 400 && Math.abs(dy) <= 400;
  }

  dispose(): void {
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('pointerlockerror', this.onLockError);
  }

  private readonly onLockChange = (): void => {
    const locked = document.pointerLockElement === this.element;
    if (locked === this.locked) return;
    this.locked = locked;
    this.skipNext = locked;
    this.onChange?.(locked);
  };

  private readonly onLockError = (): void => {
    if (this.rawRefused) {
      this.rawRefused = false;
      return;
    }
    this.locked = false;
    this.onChange?.(false);
  };
}
