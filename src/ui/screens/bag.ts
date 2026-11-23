import { HOTBAR_SLOTS } from '../../core/player.ts';
import { t } from '../../i18n/i18n.ts';
import type { InventoryCommand } from '../../sim/commands.ts';
import { h } from '../h.ts';
import { dropCommand, hotkeyCommand, splitCount } from '../inventoryGestures.ts';
import { type ItemArt, type Slots, SlotView, stackName } from '../itemSlot.ts';

/** Bag columns (6×4). */
const BAG_COLUMNS = 6;
const MOUSE_LEFT = 0;
const MOUSE_RIGHT = 2;

export interface BagActions {
  /** Sends an inventory command to the simulation (the only way the bag changes anything). */
  send(command: InventoryCommand): void;
  /** Interface click sound. */
  click(): void;
}

interface Drag {
  readonly from: number;
  readonly count: number;
  readonly pointerId: number;
  readonly ghost: HTMLElement;
}

/**
 * The bag screen (E or Tab): the 6×4 bag above the hotbar. Pointer drag and drop moves a stack,
 * a right-button drag moves half of it, Shift+click sends it across (hotbar ⇄ bag) and a hotbar
 * number key over a slot swaps it with that hotbar slot. It only sends inventory commands and
 * shows what the simulation answers.
 */
export class BagScreen {
  readonly element: HTMLElement;
  private readonly art: ItemArt;
  private readonly actions: BagActions;
  private readonly slots: SlotView[] = [];
  private readonly caption: HTMLElement;
  private readonly closeHint: HTMLElement;
  private readonly closeKey: () => string;
  private inventory: Slots = [];
  private hovered = -1;
  private drag: Drag | null = null;

  /**
   * `closeKey`: label of the key that opens and closes the bag, read at each opening (labels
   * improve once the keyboard layout map has loaded).
   */
  constructor(art: ItemArt, actions: BagActions, slotCount: number, closeKey: () => string) {
    this.art = art;
    this.actions = actions;
    this.closeKey = closeKey;
    for (let i = 0; i < slotCount; i++) this.slots.push(new SlotView(i, art));
    const views = (from: number, to: number) => this.slots.slice(from, to).map((s) => s.element);
    this.caption = h('p', { class: 'bag-caption' });
    this.closeHint = h('p', { class: 'bag-close' });
    const panel = h(
      'div',
      { class: 'bag-panel' },
      h('header', { class: 'bag-header' }, h('h2', null, t('bag.title')), this.closeHint),
      h(
        'div',
        { class: 'bag-grid', attrs: { style: `--columns: ${BAG_COLUMNS}` } },
        ...views(HOTBAR_SLOTS, slotCount),
      ),
      h('p', { class: 'bag-section' }, t('bag.hotbar')),
      h(
        'div',
        { class: 'bag-grid', attrs: { style: `--columns: ${HOTBAR_SLOTS}` } },
        ...views(0, HOTBAR_SLOTS),
      ),
      this.caption,
      h('p', { class: 'bag-help' }, t('bag.help', { first: 1, last: HOTBAR_SLOTS })),
    );
    this.element = h(
      'section',
      {
        id: 'screen-bag',
        class: 'screen screen-bag',
        on: {
          pointerdown: this.onPointerDown,
          pointermove: this.onPointerMove,
          pointerup: this.onPointerUp,
          pointercancel: this.endDrag,
          pointerover: this.onPointerOver,
          contextmenu: (event) => event.preventDefault(),
        },
      },
      panel,
    );
    this.element.hidden = true;
  }

  isOpen(): boolean {
    return !this.element.hidden;
  }

  open(): void {
    if (this.isOpen()) return;
    this.closeHint.textContent = t('bag.close', { key: this.closeKey() });
    this.element.hidden = false;
    this.actions.click();
  }

  close(): void {
    if (!this.isOpen()) return;
    this.endDrag();
    this.element.hidden = true;
    this.hover(-1);
    this.actions.click();
  }

  /** Shows the inventory (call when it changes and regularly; unchanged slots cost nothing). */
  update(inventory: Slots): void {
    this.inventory = inventory;
    for (let i = 0; i < this.slots.length; i++) this.slots[i]!.set(inventory[i] ?? null);
    if (this.hovered >= 0) this.hover(this.hovered);
  }

  /** A hotbar number key (slot 0–7) pressed while the bag is open. */
  hotkey(hotbarSlot: number): void {
    const command = hotkeyCommand(this.inventory, this.hovered, hotbarSlot);
    if (command) this.send(command);
  }

  private send(command: InventoryCommand): void {
    this.actions.send(command);
    this.actions.click();
  }

  private hover(slot: number): void {
    this.hovered = slot;
    const stack = slot >= 0 ? this.inventory[slot] : null;
    const text = stack ? stackName(this.art, stack) : '';
    if (this.caption.textContent !== text) this.caption.textContent = text;
  }

  private readonly onPointerOver = (event: PointerEvent): void => {
    this.hover(slotOf(event.target));
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    const slot = slotOf(event.target);
    const stack = slot >= 0 ? this.inventory[slot] : null;
    if (!stack || this.drag) return;
    event.preventDefault();
    if (event.button === MOUSE_LEFT && event.shiftKey) {
      this.send({ type: 'inv.quickMove', slot });
      return;
    }
    if (event.button !== MOUSE_LEFT && event.button !== MOUSE_RIGHT) return;
    const count = event.button === MOUSE_RIGHT ? splitCount(stack.count) : stack.count;
    const source = this.slots[slot]!.element;
    const ghost = source.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('data-slot');
    ghost.classList.add('slot-ghost');
    ghost.classList.remove('selected');
    const label = ghost.querySelector('.slot-count');
    if (label && label.textContent !== '') label.textContent = String(count);
    this.element.append(ghost);
    source.classList.add('dragging');
    this.element.setPointerCapture(event.pointerId);
    this.drag = { from: slot, count, pointerId: event.pointerId, ghost };
    this.moveGhost(event);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.drag?.pointerId === event.pointerId) this.moveGhost(event);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (drag?.pointerId !== event.pointerId) return;
    // The ghost ignores the pointer, so this finds the slot under it (or nothing).
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const to = hit && this.element.contains(hit) ? slotOf(hit) : -1;
    this.endDrag();
    const command = dropCommand(this.inventory, drag.from, to, drag.count);
    if (command) this.send(command);
  };

  private readonly endDrag = (): void => {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    drag.ghost.remove();
    this.slots[drag.from]?.element.classList.remove('dragging');
    if (this.element.hasPointerCapture(drag.pointerId))
      this.element.releasePointerCapture(drag.pointerId);
  };

  private moveGhost(event: PointerEvent): void {
    this.drag!.ghost.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
  }
}

/** Index of the slot an event target is in, or −1. */
function slotOf(target: EventTarget | null): number {
  if (!(target instanceof Element)) return -1;
  const slot = target.closest('[data-slot]')?.getAttribute('data-slot');
  return slot ? Number(slot) : -1;
}
