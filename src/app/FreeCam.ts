import type { CameraPose } from '../render/WorldView.ts';

/**
 * Developer free camera (M1–M2). Keys are bound by physical position (KeyboardEvent.code), so the
 * same keys work on QWERTY and AZERTY. Mouse look uses Pointer Lock, or dragging with `?noLock=1`.
 */
export class FreeCam {
  readonly pose: CameraPose;
  speed = 12;
  private readonly keys = new Set<string>();
  private readonly element: HTMLElement;
  private readonly useLock: boolean;
  private dragging = false;
  private readonly sensitivity = 0.0025;

  constructor(element: HTMLElement, pose: CameraPose, useLock: boolean) {
    this.element = element;
    this.pose = { ...pose };
    this.useLock = useLock;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    element.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
  }

  set(pose: Partial<CameraPose>): void {
    Object.assign(this.pose, pose);
  }

  update(dt: number): void {
    const forward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const lift = (this.keys.has('Space') ? 1 : 0) - (this.keys.has('KeyC') ? 1 : 0);
    if (forward === 0 && strafe === 0 && lift === 0) return;
    const speed = this.speed * (this.keys.has('ShiftLeft') ? 4 : 1) * dt;
    const sin = Math.sin(this.pose.yaw);
    const cos = Math.cos(this.pose.yaw);
    this.pose.x += (-sin * forward + cos * strafe) * speed;
    this.pose.z += (-cos * forward - sin * strafe) * speed;
    this.pose.y += lift * speed;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.element.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
  }

  private look(dx: number, dy: number): void {
    this.pose.yaw -= dx * this.sensitivity;
    this.pose.pitch = Math.max(-1.55, Math.min(1.55, this.pose.pitch - dy * this.sensitivity));
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Space') event.preventDefault();
    this.keys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.dragging = false;
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (this.useLock && document.pointerLockElement !== this.element) {
      // Chrome returns a promise; other browsers may return undefined.
      const request = this.element.requestPointerLock() as Promise<void> | undefined;
      request?.catch(() => {});
      return;
    }
    if (!this.useLock && event.button === 0) this.dragging = true;
  };

  private readonly onMouseUp = (): void => {
    this.dragging = false;
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement === this.element || this.dragging)
      this.look(event.movementX, event.movementY);
  };
}
