import type { ClientTarget, InputCommand } from '../sim/commands.ts';
import {
  type Action,
  actionForCode,
  DEFAULT_BINDINGS,
  HOTBAR_CODES,
  type KeyBindings,
  RESERVED_CODES,
  UNBOUND,
} from './bindings.ts';
import { KeyLabels } from './keyLabels.ts';
import { clampPitch, type LookTarget } from './LookTarget.ts';
import { PointerLock } from './pointerLock.ts';
import { SprintLatch } from './sprintLatch.ts';

/** View turn (radians) per pixel of mouse movement at sensitivity 1 (Settings scale it). */
export const BASE_SENSITIVITY = 0.0025;
/** Wheel distance (pixels) that moves the hotbar by one slot, so trackpad inertia does not spin it. */
const WHEEL_STEP = 60;

export interface InputOptions {
  /** Capture the mouse with Pointer Lock (otherwise: drag with the left button to look around). */
  readonly pointerLock: boolean;
  readonly language: string;
}

/**
 * Keyboard and mouse state, by physical key. Produces per-tick commands (CommandBuilder) and
 * applies mouse movement to the view every frame. The bindings, the mouse and the crouch mode are
 * the player's settings (the app sets them; a change applies from the next key press).
 */
export class InputManager {
  readonly labels: KeyLabels;
  readonly pointer: PointerLock | null;
  bindings: KeyBindings = DEFAULT_BINDINGS;
  /** Radians per pixel. */
  sensitivity = BASE_SENSITIVITY;
  invertY = false;
  /** Each press of crouch turns it on or off (otherwise: crouched while the key is held). */
  crouchToggle = false;
  /** False while a menu or screen owns the keyboard. */
  enabled = true;
  slot = 0;
  private readonly element: HTMLElement;
  private readonly down = new Set<string>();
  private readonly edges = new Set<Action>();
  /** Actions pressed since the last sample: a tap shorter than a tick still reaches the sim. */
  private readonly latched = new Set<Action>();
  private readonly forced = new Map<Action, number>();
  private mouseDx = 0;
  private mouseDy = 0;
  private wheel = 0;
  private dragging = false;
  /** Crouched by a toggle press (crouchToggle); a release of every key stands up again. */
  private crouched = false;
  /** Forward pressed twice in a row: sprint while it stays held (released with its last key). */
  private readonly sprintLatch = new SprintLatch();

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
    if (this.isForced(action)) return true;
    return this.enabled && this.keyHeld(action);
  }

  /** +1 while `plus` is held, −1 while `minus` is, 0 for both or neither. */
  axis(plus: Action, minus: Action): number {
    return (this.isDown(plus) ? 1 : 0) - (this.isDown(minus) ? 1 : 0);
  }

  /** True while either Shift key is held (Shift+G throws the whole stack). */
  shiftHeld(): boolean {
    return this.down.has('ShiftLeft') || this.down.has('ShiftRight');
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

  /**
   * Builds this tick's command from the held keys, the view and the block the client aims at.
   * Buttons pressed and released since the previous sample count as held for this tick. Sprint is
   * its key, or forward held after a double tap.
   */
  sample(look: LookTarget, target?: ClientTarget): InputCommand {
    const command: InputCommand = {
      type: 'input',
      forward: this.axis('forward', 'back'),
      strafe: this.axis('right', 'left'),
      jump: this.isDown('jump') || this.latched.has('jump'),
      sprint: this.isDown('sprint') || (this.sprintLatch.on && this.isDown('forward')),
      crouch: this.crouchToggle ? this.crouched || this.isForced('crouch') : this.isDown('crouch'),
      yaw: look.yaw,
      pitch: clampPitch(look.pitch),
      primary: this.isDown('primary') || this.latched.has('primary'),
      secondary: this.isDown('secondary') || this.latched.has('secondary'),
      slot: this.slot,
      ...(target ? { target } : {}),
    };
    this.latched.clear();
    return command;
  }

  /** Label of the first key bound to an action, on the player's keyboard layout. */
  keyLabel(action: Action): string {
    return this.labels.label(this.bindings[action].find((code) => code !== UNBOUND) ?? '');
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

  /** Forgets held keys, pending taps and edges (focus loss, pause, opening a screen). */
  readonly releaseAll = (): void => {
    this.down.clear();
    this.latched.clear();
    this.edges.clear();
    this.sprintLatch.forget();
    this.dragging = false;
    this.crouched = false;
  };

  /** True while a key bound to the action is physically down. */
  private keyHeld(action: Action): boolean {
    for (const code of this.bindings[action]) if (this.down.has(code)) return true;
    return false;
  }

  private isForced(action: Action): boolean {
    return (this.forced.get(action) ?? 0) > 0;
  }

  /** A key or button goes down at `time` (the event's time stamp, ms). */
  private press(code: string, time: number): void {
    if (code === UNBOUND || RESERVED_CODES.has(code)) return;
    if (!this.down.has(code) && this.enabled) {
      const action = actionForCode(this.bindings, code);
      if (action) {
        this.edges.add(action);
        this.latched.add(action);
        if (action === 'crouch' && this.crouchToggle) this.crouched = !this.crouched;
        if (action === 'forward') this.sprintLatch.press(time);
      }
    }
    this.down.add(code);
  }

  /** A key or button goes up: the double-tap sprint ends with the last forward key held. */
  private lift(code: string): void {
    this.down.delete(code);
    if (!this.keyHeld('forward')) this.sprintLatch.release();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.labels.learn(event.code, event.key);
    if (this.takesDefault(event)) event.preventDefault();
    const slot = HOTBAR_CODES.indexOf(event.code);
    if (slot >= 0 && this.enabled) this.slot = slot;
    if (!event.repeat) this.press(event.code, event.timeStamp);
  };

  /**
   * A bound key's browser action is cancelled (Space scrolls, Tab moves the focus, F3 and the
   * quick-find keys search the page), except for the pause keys: an Esc left unmarked is how the
   * game knows no screen took it. Menus keep the browser's keys: Space and Tab type, press and move
   * between their controls; shortcuts with Ctrl, Cmd or Alt are the browser's.
   */
  private takesDefault(event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey || isFormControl(event.target)) return false;
    const action = actionForCode(this.bindings, event.code);
    return action !== null && action !== 'pause';
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.lift(event.code);
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (this.pointer && !this.pointer.isLocked()) {
      this.pointer.request();
      return;
    }
    if (!this.pointer && event.button === 0) this.dragging = true;
    this.press(`Mouse${event.button}`, event.timeStamp);
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    this.lift(`Mouse${event.button}`);
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

/** A menu control (field, button…) has the key: the browser's own handling must happen. */
function isFormControl(target: EventTarget | null | undefined): boolean {
  return (
    typeof Element !== 'undefined' &&
    target instanceof Element &&
    target.closest('input, select, textarea, button') !== null
  );
}

/**
 * A text box has the key (the New world name and seed): it is typed there, not a game key. Not a
 * slider, box or button, where keys type nothing. Read by tag and type, so Node tests can send
 * the screens' own stand-in elements.
 */
export function isTextField(target: EventTarget | null | undefined): boolean {
  const field = target as { readonly tagName?: unknown; readonly type?: unknown } | null;
  return field?.tagName === 'TEXTAREA' || (field?.tagName === 'INPUT' && field.type === 'text');
}
