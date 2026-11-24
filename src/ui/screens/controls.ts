import { t } from '../../i18n/i18n.ts';
import {
  ACTIONS,
  type Action,
  DEFAULT_BINDINGS,
  type KeyBindings,
  rebind,
} from '../../input/bindings.ts';
import { h } from '../h.ts';
import { menuButton, menuPanel } from './menuParts.ts';

export interface ControlsActions {
  /** A key's or mouse button's label on the player's keyboard layout. */
  label(code: string): string;
  /** New bindings, at once: the app applies and stores them. */
  change(bindings: KeyBindings): void;
  back(): void;
}

/** One key slot of an action, and its button. */
interface KeySlot {
  readonly action: Action;
  readonly slot: number;
  readonly button: HTMLButtonElement;
}

/**
 * The Key bindings screen (docs « Settings » → commandes, « Entrées »): every action with its key
 * slots (as many as its defaults), labelled from the player's keyboard layout. A click on a slot
 * waits for a key, or for a mouse button pressed on that slot; Esc cancels, except on a pause
 * slot (Esc is the pause key's own), and a press anywhere else stops waiting. A key no action may
 * take (Ctrl, Cmd, Alt, F5, F11, F12, the hotbar digits), one another slot holds, or a mouse button
 * for an action only keys drive (bag, debug overlay, pause) is refused with a line saying so:
 * conflicts are never swapped. Reset to defaults puts every key back. While it waits, the screen
 * takes every key first (window, capture phase), so neither the pause, the bag nor the debug
 * overlay sees it.
 */
export class ControlsScreen {
  readonly element: HTMLElement;
  private readonly actions: ControlsActions;
  private bindings: KeyBindings = DEFAULT_BINDINGS;
  private readonly slots: KeySlot[] = [];
  private readonly status: HTMLElement;
  private waiting: KeySlot | null = null;
  /** A left button just bound on its slot: the click that ends the press does not wait again. */
  private boundByClick = false;

  constructor(actions: ControlsActions) {
    this.actions = actions;
    const rows = ACTIONS.map((action) =>
      h(
        'div',
        { class: 'setting key-row' },
        h('span', { class: 'setting-label' }, t(`action.${action}`)),
        h(
          'div',
          { class: 'key-slots' },
          ...DEFAULT_BINDINGS[action].map((_, slot) => this.slotButton(action, slot)),
        ),
      ),
    );
    this.status = h('p', { class: 'menu-small controls-status', attrs: { role: 'status' } });
    const reset = menuButton('reset-keys', t('controls.reset'), () => {
      this.stop();
      this.apply(DEFAULT_BINDINGS);
      this.say(t('controls.restored'));
    });
    const done = menuButton('back', t('menu.back'), actions.back, 'button');
    this.element = menuPanel(
      'screen-controls',
      'controls.title',
      h('p', { class: 'menu-small' }, t('controls.intro')),
      h('div', { class: 'key-list' }, ...rows),
      this.status,
      h('div', { class: 'menu-row' }, done, reset),
    );
  }

  /** Shows these bindings (before the screen opens). */
  show(bindings: KeyBindings): void {
    this.stop();
    this.bindings = bindings;
    this.say('');
    this.render();
  }

  /** Stops waiting for a key (a key came, or the screen closes). */
  stop(): void {
    if (!this.waiting) return;
    this.waiting = null;
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('mousedown', this.onPress, true);
    this.render();
  }

  private slotButton(action: Action, slot: number): HTMLButtonElement {
    const button = h('button', {
      class: 'button ghost small key-slot',
      attrs: { type: 'button', 'data-bind': `${action}:${slot}` },
    });
    const entry: KeySlot = { action, slot, button };
    this.slots.push(entry);
    button.addEventListener('mousedown', (event) => {
      this.boundByClick = false;
      if (this.waiting !== entry) return;
      event.preventDefault();
      this.boundByClick = event.button === 0;
      this.choose(`Mouse${event.button}`);
    });
    button.addEventListener('click', () => {
      if (this.boundByClick) this.boundByClick = false;
      else this.wait(entry);
    });
    // A right button pressed to bind it opens no menu.
    button.addEventListener('contextmenu', (event) => event.preventDefault());
    return button;
  }

  private wait(entry: KeySlot): void {
    this.stop();
    this.waiting = entry;
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('mousedown', this.onPress, true);
    this.say(t('controls.press', { action: t(`action.${entry.action}`) }));
    this.render();
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    event.preventDefault();
    // Not even the window's other listeners (pause, bag, debug) see it, wherever it was sent.
    event.stopImmediatePropagation();
    // Keys the browser cannot name (some media keys) are not bindable.
    if (event.repeat || event.code === '') return;
    if (event.code === 'Escape' && this.waiting?.action !== 'pause') {
      this.stop();
      this.say('');
    } else {
      this.choose(event.code);
    }
  };

  /** A press off the waiting slot stops waiting (and does what it does: Back goes back). */
  private readonly onPress = (event: MouseEvent): void => {
    if (event.target !== this.waiting?.button) {
      this.stop();
      this.say('');
    }
  };

  /** The waiting slot takes `code`, or the line says why not. */
  private choose(code: string): void {
    const entry = this.waiting;
    if (!entry) return;
    this.stop();
    const result = rebind(this.bindings, entry.action, entry.slot, code);
    const key = this.actions.label(code);
    if (result.ok) {
      this.say('');
      this.apply(result.bindings);
    } else if (result.reason === 'taken') {
      this.say(t('controls.taken', { key, action: t(`action.${result.by}`) }));
    } else if (result.reason === 'keyOnly') {
      this.say(t('controls.keyOnly', { key, action: t(`action.${entry.action}`) }));
    } else {
      this.say(t('controls.reserved', { key }));
    }
  }

  private apply(bindings: KeyBindings): void {
    if (bindings !== this.bindings) {
      this.bindings = bindings;
      this.actions.change(bindings);
    }
    this.render();
  }

  private say(text: string): void {
    this.status.textContent = text;
  }

  private render(): void {
    for (const entry of this.slots) {
      const waiting = entry === this.waiting;
      const code = this.bindings[entry.action][entry.slot] ?? '';
      entry.button.textContent = waiting ? t('controls.waiting') : this.actions.label(code);
      entry.button.classList.toggle('waiting', waiting);
    }
  }
}
