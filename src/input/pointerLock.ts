/**
 * Pointer Lock with the quirks handled: the request may return a promise or undefined, the raw
 * (unadjusted) mode is tried first, the first movement after locking and implausible jumps are
 * dropped, and an unexpected unlock is reported (the game pauses).
 */
export class PointerLock {
  private readonly element: HTMLElement;
  private locked = false;
  private skipNext = false;
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
    const element = this.element as HTMLElement & {
      requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | undefined;
    };
    try {
      const attempt = element.requestPointerLock({ unadjustedMovement: true });
      if (attempt && typeof attempt.then === 'function') {
        attempt.catch(() => {
          // Raw input unsupported or refused: try the plain mode.
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
    this.locked = false;
    this.onChange?.(false);
  };
}
