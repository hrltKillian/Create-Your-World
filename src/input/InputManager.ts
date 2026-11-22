import type { InputCommand } from '../sim/commands.ts';
import {
  type Action,
  actionForCode,
  DEFAULT_BINDINGS,
  HOTBAR_CODES,
  RESERVED_CODES,
} from './bindings.ts';
import { KeyLabels } from './keyLabels.ts';
import { clampPitch, type LookTarget } from './LookTarget.ts';
import { PointerLock } from './pointerLock.ts';

/** Wheel distance (pixels) that moves the hotbar by one slot, so trackpad inertia does not spin it. */
const WHEEL_STEP = 60;
const PREVENT_DEFAULT: ReadonlySet<string> = new Set([
  'Space',
  'Tab',
  'F3',
  'Backquote',
  'IntlBackslash',
]);

export interface InputOptions {
  /** Capture the mouse with Pointer Lock (otherwise: drag with the left button to look around). */
  readonly pointerLock: boolean;
  readonly language: string;
}

/**
 * Keyboard and mouse state, by physical key. Produces per-tick commands (CommandBuilder) and
 * applies mouse movement to the view every frame.
 */
export class InputManager {
  readonly labels: KeyLabels;
  readonly pointer: PointerLock | null;
  bindings: Readonly<Record<Action, readonly string[]>> = DEFAULT_BINDINGS;
  sensitivity = 0.0025;
  invertY = false;
  /** False while a menu or screen owns the keyboard. */
  enabled = true;
  slot = 0;
  private readonly element: HTMLElement;
  private readonly down = new Set<string>();
  private readonly edges = new Set<Action>();
  private readonly forced = new Map<Action, number>();
  private mouseDx = 0;
  private mouseDy = 0;
  private wheel = 0;
  private dragging = false;

  constructor(element: HTMLElement, options: InputOptions) {
    this.element = element;
    this.labels = new KeyLabels(options.language);
    this.pointer = options.pointerLock ? new PointerLock(element) : null;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseAll);
    element.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    element.addEventListener('wheel', this.onWheel, { passive: true });
    element.addEventListener('contextmenu', this.onContextMenu);
  }

  /** True while an action's key is held (or forced by automation). */
  isDown(action: Action): boolean {
    if ((this.forced.get(action) ?? 0) > 0) return true;
    if (!this.enabled) return false;
    for (const code of this.bindings[action]) if (this.down.has(code)) return true;
    return false;
  }

  /** True once per key press (edge-latched until consumed). */
  consume(action: Action): boolean {
    return this.edges.delete(action);
  }

  /** Holds an action for `ticks` simulation ticks (automation and tests). */
  force(action: Action, ticks: number): void {
    this.forced.set(action, ticks);
  }

  /** Call after each simulation tick: counts forced actions down. */
  tickForced(): void {
    for (const [action, ticks] of this.forced) {
      if (ticks <= 1) this.forced.delete(action);
      else this.forced.set(action, ticks - 1);
    }
  }

  /** Applies the mouse movement gathered since the last frame to the view. */
  applyMouseLook(target: LookTarget): void {
    if (this.mouseDx !== 0 || this.mouseDy !== 0) {
      target.addLook(
        -this.mouseDx * this.sensitivity,
        (this.invertY ? 1 : -1) * this.mouseDy * this.sensitivity,
      );
      target.pitch = clampPitch(target.pitch);
    }
    this.mouseDx = 0;
    this.mouseDy = 0;
  }

  /** Builds this tick's command from the held keys and the view. */
  sample(look: LookTarget): InputCommand {
    const axis = (plus: Action, minus: Action) =>
      (this.isDown(plus) ? 1 : 0) - (this.isDown(minus) ? 1 : 0);
    return {
      type: 'input',
      forward: axis('forward', 'back'),
      strafe: axis('right', 'left'),
      jump: this.isDown('jump'),
      sprint: this.isDown('sprint'),
      crouch: this.isDown('crouch'),
      yaw: look.yaw,
      pitch: look.pitch,
      primary: this.isDown('primary'),
      secondary: this.isDown('secondary'),
      slot: this.slot,
    };
  }

  /** Label of the first key bound to an action, on the player's keyboard layout. */
  keyLabel(action: Action): string {
    return this.labels.label(this.bindings[action][0] ?? '');
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.releaseAll);
    this.element.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.element.removeEventListener('wheel', this.onWheel);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
    this.pointer?.dispose();
  }

  readonly releaseAll = (): void => {
    this.down.clear();
    this.dragging = false;
  };

  private press(code: string): void {
    if (RESERVED_CODES.has(code)) return;
    if (!this.down.has(code)) {
      const action = actionForCode(this.bindings, code);
      if (action) this.edges.add(action);
    }
    this.down.add(code);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.labels.learn(event.code, event.key);
    if (PREVENT_DEFAULT.has(event.code)) event.preventDefault();
    const slot = (HOTBAR_CODES as readonly string[]).indexOf(event.code);
    if (slot >= 0 && this.enabled) this.slot = slot;
    if (!event.repeat) this.press(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.down.delete(event.code);
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (this.pointer && !this.pointer.isLocked()) {
      this.pointer.request();
      return;
    }
    if (!this.pointer && event.button === 0) this.dragging = true;
    this.press(`Mouse${event.button}`);
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    this.down.delete(`Mouse${event.button}`);
    if (event.button === 0) this.dragging = false;
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (this.pointer ? this.pointer.accept(event.movementX, event.movementY) : this.dragging) {
      this.mouseDx += event.movementX;
      this.mouseDy += event.movementY;
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    this.wheel += event.deltaY * (event.deltaMode === 1 ? 40 : 1);
    while (Math.abs(this.wheel) >= WHEEL_STEP) {
      const step = Math.sign(this.wheel);
      this.slot = (this.slot + step + HOTBAR_CODES.length) % HOTBAR_CODES.length;
      this.wheel -= step * WHEEL_STEP;
    }
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };
}
