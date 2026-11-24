import type { StationDef } from '../../content/schema.ts';
import { HOTBAR_SLOTS } from '../../core/player.ts';
import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';
import type { Slots } from '../itemSlot.ts';
import { type ScreenDeps, SlotBoard, slotGrid } from '../slotBoard.ts';
import type { LogbookPanel, LogbookState } from './logbook.ts';

/**
 * The Workbench screen (decision 18, docs « Écrans »): its Logbook (the bench's recipes and its
 * queue of 5, crafted by the bench itself), its outputs (slots from 64; they only give: a click
 * takes, Shift+click sends to the inventory), the bag and the hotbar. No crafting grid.
 */
export class WorkbenchScreen {
  readonly element: HTMLElement;
  readonly logbook: LogbookPanel;
  private readonly board: SlotBoard;
  private readonly base: number;
  private readonly title: HTMLElement;
  private readonly outputs: HTMLElement;

  constructor(deps: ScreenDeps, logbook: LogbookPanel) {
    this.logbook = logbook;
    const board = new SlotBoard(deps, 'screen-workbench');
    this.board = board;
    this.base = deps.openBase;
    this.element = board.element;
    this.title = h('h2');
    this.outputs = h('div', { class: 'workbench-outputs' });
    this.element.append(
      h(
        'div',
        { class: 'bag-panel' },
        board.header(this.title),
        h(
          'div',
          { class: 'bag-columns' },
          logbook.element,
          h(
            'div',
            { class: 'bag-inventory' },
            h('p', { class: 'bag-section' }, t('workbench.outputs')),
            this.outputs,
            h('p', { class: 'bag-section' }, t('bag.title')),
            ...board.inventory(),
            board.caption,
          ),
        ),
        h('p', { class: 'bag-help' }, t('bag.help', { first: 1, last: HOTBAR_SLOTS })),
      ),
    );
  }

  isOpen(): boolean {
    return this.board.isOpen();
  }

  /** Shows a workbench of a station named `title`, its outputs laid out from its definition. */
  open(station: StationDef, title: string): void {
    this.title.textContent = title;
    const board = this.board;
    board.dropViews(this.base);
    const views = board.slotViews(this.base, this.base + station.outputSlots);
    this.outputs.replaceChildren(slotGrid(views, station.outputSlots));
    board.open();
  }

  close(): void {
    this.board.close();
  }

  /** Shows the inventory then the outputs, and the bench's Logbook and queue. */
  update(slots: Slots, logbook: LogbookState): void {
    this.board.update(slots);
    this.logbook.update(logbook);
  }

  hotkey(hotbarSlot: number): void {
    this.board.hotkey(hotbarSlot);
  }
}
