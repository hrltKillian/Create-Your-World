import { t } from '../i18n/i18n.ts';
import { h } from './h.ts';
import { menuButton } from './screens/menuParts.ts';

/** Seconds an onboarding tip stays on screen (`#hud-tip`, a longer read than a hint). */
export const TIP_SECONDS = 7;

/** One line of the controls card: what it does (i18n key) and the labels of its keys. */
export interface ControlRow {
  readonly labelKey: string;
  /** As the player's keyboard prints them (`InputManager.keyLabel`), or a word (« Mouse »). */
  readonly keys: readonly string[];
}

/**
 * The controls card of the first launch (`#onboarding-card`, docs « Prise en main »): every
 * action with the keys of the player's own keyboard layout, over the click-to-play overlay.
 * « Got it » (`data-action="onboarding-close"`) dismisses it; the rows are written again once the
 * keyboard layout map has loaded.
 */
export class ControlsCard {
  readonly element: HTMLElement;
  private readonly rows: HTMLElement;

  constructor(onClose: () => void) {
    this.rows = h('dl', { class: 'controls-rows' });
    const close = menuButton('onboarding-close', t('onboarding.close'), onClose, 'button');
    this.element = h(
      'section',
      {
        id: 'onboarding-card',
        class: 'screen screen-onboarding',
        attrs: { role: 'dialog', 'aria-labelledby': 'onboarding-title' },
      },
      h(
        'div',
        { class: 'onboarding-panel' },
        h('h2', { id: 'onboarding-title', class: 'onboarding-title' }, t('onboarding.title')),
        h('p', { class: 'onboarding-intro' }, t('onboarding.intro')),
        this.rows,
        close,
      ),
    );
    this.element.hidden = true;
  }

  isOpen(): boolean {
    return !this.element.hidden;
  }

  /** Shows the card with these rows. */
  show(rows: readonly ControlRow[]): void {
    this.setRows(rows);
    this.element.hidden = false;
  }

  /** Writes the rows (each key in its own cap). */
  setRows(rows: readonly ControlRow[]): void {
    const lines = rows.flatMap((row) => [
      h('dt', null, t(row.labelKey)),
      h('dd', null, ...row.keys.map((key) => h('kbd', null, key))),
    ]);
    this.rows.replaceChildren(...lines);
  }

  hide(): void {
    this.element.hidden = true;
  }
}
