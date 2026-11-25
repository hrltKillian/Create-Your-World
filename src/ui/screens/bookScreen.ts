import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';
import type { ScreenActions } from '../slotBoard.ts';
import { menuButton } from './menuParts.ts';

/**
 * A journal read (plan v3 « M28 », secondary with it in hand): its name and its text on a page of
 * a fixed size, the text scrolling inside. Closed by its button or the Bag's key. The client's
 * alone: the simulation has no screen open for it.
 */
export class BookScreen {
  readonly element: HTMLElement;
  private readonly title: HTMLElement;
  private readonly text: HTMLElement;
  private readonly closeHint: HTMLElement;
  private readonly actions: ScreenActions;
  private readonly closeKey: () => string;

  constructor(actions: ScreenActions, closeKey: () => string, onClose: () => void) {
    this.actions = actions;
    this.closeKey = closeKey;
    this.title = h('h2');
    this.text = h('div', { class: 'book-text' });
    this.closeHint = h('p', { class: 'bag-close' });
    const close = menuButton('book-close', t('book.close'), onClose);
    this.element = h(
      'section',
      { id: 'screen-book', class: 'screen screen-book' },
      h(
        'div',
        { class: 'bag-panel book-panel' },
        h('header', { class: 'bag-header' }, this.title, this.closeHint),
        this.text,
        h('div', { class: 'book-actions' }, close),
      ),
    );
    this.element.hidden = true;
  }

  isOpen(): boolean {
    return !this.element.hidden;
  }

  /** Shows a journal: its name, then its text, a paragraph per line, from the top. */
  open(title: string, text: string): void {
    this.title.textContent = title;
    this.text.replaceChildren(...text.split('\n').map((line) => h('p', null, line)));
    this.text.scrollTop = 0;
    this.closeHint.textContent = t('bag.close', { key: this.closeKey() });
    this.element.hidden = false;
    this.actions.click();
  }

  close(): void {
    if (!this.isOpen()) return;
    const active = document.activeElement as HTMLElement | null | undefined;
    if (active && this.element.contains(active)) active.blur();
    this.element.hidden = true;
    this.actions.click();
  }

  /** No slots in a book. */
  hotkey(): void {}

  /** The text shown (tests and selftests). */
  shownText(): string {
    return this.text.textContent ?? '';
  }
}
