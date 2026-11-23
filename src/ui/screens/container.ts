import { HOTBAR_SLOTS } from '../../core/player.ts';
import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';
import type { Slots } from '../itemSlot.ts';
import {
  BAG_COLUMNS,
  type ScreenActions,
  type ScreenDeps,
  SlotBoard,
  slotGrid,
} from '../slotBoard.ts';
import { menuButton } from './menuParts.ts';

/**
 * The Container screen (a chest, docs « Écrans »): its slots above the bag and the hotbar, « Take
 * all » (everything into the inventory) and « Store all » (the bag, not the hotbar, into the chest).
 * Slots take the bag's gestures; Shift+click sends a stack to the other side.
 */
export class ContainerScreen {
  readonly element: HTMLElement;
  private readonly board: SlotBoard;
  private readonly actions: ScreenActions;
  private readonly base: number;
  private readonly title: HTMLElement;
  private readonly chest: HTMLElement;
  private slots: Slots = [];

  constructor(deps: ScreenDeps) {
    const board = new SlotBoard(deps, 'container.move', 'screen-container');
    this.board = board;
    this.actions = deps.actions;
    this.base = deps.slotCount;
    this.element = board.element;
    this.title = h('h2');
    this.chest = h('div', { class: 'container-slots' });
    const takeAll = menuButton('take-all', t('container.takeAll'), this.takeAll);
    const storeAll = menuButton('store-all', t('container.storeAll'), this.storeAll);
    this.element.append(
      h(
        'div',
        { class: 'bag-panel' },
        board.header(this.title),
        this.chest,
        h('div', { class: 'container-actions' }, takeAll, storeAll),
        h('p', { class: 'bag-section' }, t('bag.title')),
        ...board.inventory(),
        board.caption,
        h('p', { class: 'bag-help' }, t('bag.help', { first: 1, last: HOTBAR_SLOTS })),
      ),
    );
  }

  isOpen(): boolean {
    return this.board.isOpen();
  }

  /** Shows a container of `size` slots named `title`. */
  open(title: string, size: number): void {
    this.title.textContent = title;
    this.board.dropViews(this.base);
    this.chest.replaceChildren(
      slotGrid(this.board.slotViews(this.base, this.base + size), BAG_COLUMNS),
    );
    this.board.open();
  }

  close(): void {
    this.board.close();
  }

  /** Shows the inventory, then the container's slots. */
  update(slots: Slots): void {
    this.slots = slots;
    this.board.update(slots);
  }

  hotkey(hotbarSlot: number): void {
    this.board.hotkey(hotbarSlot);
  }

  /** One move per filled container slot, each into the inventory. */
  private readonly takeAll = (): void => {
    this.sendEach(this.base, this.slots.length);
  };

  /** One move per filled bag slot, each into the container. */
  private readonly storeAll = (): void => {
    this.sendEach(HOTBAR_SLOTS, this.base);
  };

  private sendEach(from: number, to: number): void {
    for (let slot = from; slot < to; slot++)
      if (this.slots[slot]) this.actions.send({ type: 'container.move', from: slot });
    this.actions.click();
  }
}
