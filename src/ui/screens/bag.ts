import { WEAR_SLOTS } from '../../content/schema.ts';
import { HOTBAR_SLOTS } from '../../core/player.ts';
import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';
import type { Slots } from '../itemSlot.ts';
import { type ScreenDeps, SlotBoard } from '../slotBoard.ts';
import type { LogbookPanel, LogbookState } from './logbook.ts';

/**
 * The Bag (E or Tab, docs « Écrans »): on the left the silhouette and its 5 equipment slots (worn
 * items arrive with M9), in the middle the 6×4 bag and the hotbar, on the right the Logbook.
 */
export class BagScreen {
  readonly element: HTMLElement;
  readonly logbook: LogbookPanel;
  private readonly board: SlotBoard;

  constructor(deps: ScreenDeps, logbook: LogbookPanel) {
    this.logbook = logbook;
    const board = new SlotBoard(deps, null, 'screen-bag');
    this.board = board;
    this.element = board.element;
    this.element.append(
      h(
        'div',
        { class: 'bag-panel' },
        board.header(h('h2', null, t('bag.title'))),
        h(
          'div',
          { class: 'bag-columns' },
          wearColumn(),
          h('div', { class: 'bag-inventory' }, ...board.inventory(), board.caption),
          logbook.element,
        ),
        h('p', { class: 'bag-help' }, t('bag.help', { first: 1, last: HOTBAR_SLOTS })),
      ),
    );
  }

  isOpen(): boolean {
    return this.board.isOpen();
  }

  open(): void {
    this.board.open();
  }

  close(): void {
    this.board.close();
  }

  /** Shows the inventory and the Logbook (call when they change and regularly). */
  update(inventory: Slots, logbook: LogbookState): void {
    this.board.update(inventory);
    this.logbook.update(logbook);
  }

  /** A hotbar number key (slot 0–7) pressed while the bag is open. */
  hotkey(hotbarSlot: number): void {
    this.board.hotkey(hotbarSlot);
  }
}

/** The silhouette, head to feet, with an empty box per equipment slot. */
function wearColumn(): HTMLElement {
  return h(
    'div',
    { class: 'wear' },
    h('p', { class: 'bag-section' }, t('wear.title')),
    h(
      'div',
      { class: 'wear-figure' },
      h('span', { class: 'figure-head' }),
      h('span', { class: 'figure-torso' }),
      h('span', { class: 'figure-legs' }),
      ...WEAR_SLOTS.map((slot) =>
        h(
          'div',
          { class: 'wear-slot', attrs: { 'data-wear': slot } },
          h('span', { class: 'slot' }),
          h('span', { class: 'wear-label' }, t(`wear.${slot}`)),
        ),
      ),
    ),
  );
}
