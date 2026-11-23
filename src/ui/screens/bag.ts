import { WEAR_SLOTS } from '../../content/schema.ts';
import { HOTBAR_SLOTS } from '../../core/player.ts';
import { t } from '../../i18n/i18n.ts';
import type { Gear } from '../../sim/environment.ts';
import { h } from '../h.ts';
import type { Slots } from '../itemSlot.ts';
import { type ScreenDeps, SlotBoard } from '../slotBoard.ts';
import type { LogbookPanel, LogbookState } from './logbook.ts';

/**
 * The Bag (E or Tab, docs « Écrans »): on the left the silhouette, its 5 equipment slots (slots
 * 32–36, moved with `equip.move`) and what the worn items protect from, in the middle the 6×4 bag
 * and the hotbar, on the right the Logbook.
 */
export class BagScreen {
  readonly element: HTMLElement;
  readonly logbook: LogbookPanel;
  private readonly board: SlotBoard;
  private readonly protection: HTMLElement;

  constructor(deps: ScreenDeps, logbook: LogbookPanel) {
    this.logbook = logbook;
    const board = new SlotBoard(deps, 'equip.move', 'screen-bag');
    this.board = board;
    this.element = board.element;
    this.protection = h('p', { class: 'wear-stats' });
    const worn = board.slotViews(deps.slotCount, deps.slotCount + WEAR_SLOTS.length);
    this.element.append(
      h(
        'div',
        { class: 'bag-panel' },
        board.header(h('h2', null, t('bag.title'))),
        h(
          'div',
          { class: 'bag-columns' },
          wearColumn(worn, this.protection),
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

  /**
   * Shows the inventory then the worn items, their protection and the Logbook (call when they
   * change and regularly).
   */
  update(slots: Slots, logbook: LogbookState, gear: Readonly<Gear>): void {
    this.board.update(slots);
    const text = t('wear.stats', { armor: gear.armor, warmth: gear.warmth, cooling: gear.cooling });
    if (this.protection.textContent !== text) this.protection.textContent = text;
    this.logbook.update(logbook);
  }

  /** A hotbar number key (slot 0–7) pressed while the bag is open. */
  hotkey(hotbarSlot: number): void {
    this.board.hotkey(hotbarSlot);
  }
}

/** The silhouette, head to feet, with the slot view of each equipment slot, then the protection. */
function wearColumn(worn: readonly HTMLElement[], protection: HTMLElement): HTMLElement {
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
      ...WEAR_SLOTS.map((slot, i) =>
        h(
          'div',
          { class: 'wear-slot', attrs: { 'data-wear': slot } },
          worn[i]!,
          h('span', { class: 'wear-label' }, t(`wear.${slot}`)),
        ),
      ),
    ),
    protection,
  );
}
