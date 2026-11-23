import { HOTBAR_SLOTS } from '../core/player.ts';
import { t } from '../i18n/i18n.ts';
import type { Command } from '../sim/commands.ts';
import { h } from './h.ts';
import {
  dropCommand,
  hotkeyCommand,
  quickMoveCommand,
  type SlotContext,
  splitCount,
} from './inventoryGestures.ts';
import { type ItemArt, type Slots, SlotView, stackName } from './itemSlot.ts';

/** Bag columns (6×4). */
export const BAG_COLUMNS = 6;
const MOUSE_LEFT = 0;
const MOUSE_RIGHT = 2;

export interface ScreenActions {
  /** Sends a command to the simulation (the only way a screen changes anything). */
  send(command: Command): void;
  /** Interface click sound. */
  click(): void;
}

/** What every slot screen needs. */
export interface ScreenDeps {
  readonly art: ItemArt;
  readonly actions: ScreenActions;
  /** Inventory slots (hotbar then bag); the open block entity's slots are numbered from there. */
  readonly slotCount: number;
  /** Label of the key that opens and closes the screens, read at each opening. */
  readonly closeKey: () => string;
}

interface Drag {
  readonly from: number;
  readonly count: number;
  readonly pointerId: number;
  readonly ghost: HTMLElement;
}

/**
 * The shell of a slot screen (Bag, Container, Station): a full-screen section whose `[data-slot]`
 * views take the bag's gestures. Pointer drag and drop moves a stack, a right-button drag moves
 * half of it, Shift+click sends it across and a hotbar number key over a slot swaps it with that
 * hotbar slot. It only sends commands and shows what the simulation answers.
 */
export class SlotBoard {
  readonly element: HTMLElement;
  /** Name of the hovered stack. */
  readonly caption: HTMLElement;
  private readonly art: ItemArt;
  private readonly actions: ScreenActions;
  private readonly context: SlotContext;
  private readonly closeHint: HTMLElement;
  private readonly closeKey: () => string;
  /** Views by slot number. */
  private readonly views: SlotView[] = [];
  private slots: Slots = [];
  private hovered = -1;
  private drag: Drag | null = null;

  constructor(deps: ScreenDeps, move: SlotContext['move'], id: string) {
    this.art = deps.art;
    this.actions = deps.actions;
    this.context = { base: deps.slotCount, move };
    this.closeKey = deps.closeKey;
    this.caption = h('p', { class: 'bag-caption' });
    this.closeHint = h('p', { class: 'bag-close' });
    this.element = h('section', {
      id,
      class: 'screen screen-slots',
      on: {
        pointerdown: this.onPointerDown,
        pointermove: this.onPointerMove,
        pointerup: this.onPointerUp,
        pointercancel: this.endDrag,
        pointerover: this.onPointerOver,
        contextmenu: (event) => event.preventDefault(),
      },
    });
    this.element.hidden = true;
  }

  /** The panel header: a title and the close hint. */
  header(title: Node): HTMLElement {
    return h('header', { class: 'bag-header' }, title, this.closeHint);
  }

  /** Views of the slots [from, to), made and registered under their slot numbers. */
  slotViews(from: number, to: number): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (let i = from; i < to; i++) {
      const view = new SlotView(i, this.art);
      this.views[i] = view;
      out.push(view.element);
    }
    return out;
  }

  /** Forgets the views from slot `from` on (the open block entity's, made again at each opening). */
  dropViews(from: number): void {
    this.endDrag();
    this.views.length = Math.min(this.views.length, from);
  }

  /** The bag (6×4), then the hotbar, with their views. */
  inventory(): HTMLElement[] {
    return [
      slotGrid(this.slotViews(HOTBAR_SLOTS, this.context.base), BAG_COLUMNS),
      h('p', { class: 'bag-section' }, t('bag.hotbar')),
      slotGrid(this.slotViews(0, HOTBAR_SLOTS), HOTBAR_SLOTS),
    ];
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
    // A clicked button keeps the focus while hidden: Space or Enter would press it during play.
    const active = document.activeElement as HTMLElement | null | undefined;
    if (active && this.element.contains(active)) active.blur();
    this.element.hidden = true;
    this.hover(-1);
    this.actions.click();
  }

  /**
   * Shows the slots (the inventory, then the open block entity's): call when they change and
   * regularly; unchanged slots cost nothing.
   */
  update(slots: Slots): void {
    this.slots = slots;
    for (let i = 0; i < this.views.length; i++) this.views[i]?.set(slots[i] ?? null);
    if (this.hovered >= 0) this.hover(this.hovered);
  }

  /** A hotbar number key (slot 0–7) pressed while the screen is open. */
  hotkey(hotbarSlot: number): void {
    const command = hotkeyCommand(this.context, this.slots, this.hovered, hotbarSlot);
    if (command) this.send(command);
  }

  /** Sends a command with the click sound. */
  send(command: Command): void {
    this.actions.send(command);
    this.actions.click();
  }

  private hover(slot: number): void {
    this.hovered = slot;
    const stack = slot >= 0 ? this.slots[slot] : null;
    const text = stack ? stackName(this.art, stack) : '';
    if (this.caption.textContent !== text) this.caption.textContent = text;
  }

  private readonly onPointerOver = (event: PointerEvent): void => {
    this.hover(slotOf(event.target));
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    const slot = slotOf(event.target);
    const stack = slot >= 0 ? this.slots[slot] : null;
    if (!stack || this.drag) return;
    event.preventDefault();
    if (event.button === MOUSE_LEFT && event.shiftKey) {
      this.send(quickMoveCommand(this.context, slot));
      return;
    }
    const source = this.views[slot]?.element;
    if (!source || (event.button !== MOUSE_LEFT && event.button !== MOUSE_RIGHT)) return;
    const count = event.button === MOUSE_RIGHT ? splitCount(stack.count) : stack.count;
    const ghost = source.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('data-slot');
    ghost.classList.add('slot-ghost');
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
    const command = dropCommand(this.context, this.slots, drag.from, to, drag.count);
    if (command) this.send(command);
  };

  private readonly endDrag = (): void => {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    drag.ghost.remove();
    this.views[drag.from]?.element.classList.remove('dragging');
    if (this.element.hasPointerCapture(drag.pointerId))
      this.element.releasePointerCapture(drag.pointerId);
  };

  private moveGhost(event: PointerEvent): void {
    this.drag!.ghost.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
  }
}

/** A grid of slot views, `columns` wide. */
export function slotGrid(views: readonly HTMLElement[], columns: number): HTMLElement {
  return h('div', { class: 'bag-grid', attrs: { style: `--columns: ${columns}` } }, ...views);
}

/** Index of the slot an event target is in, or −1. */
function slotOf(target: EventTarget | null): number {
  if (!(target instanceof Element)) return -1;
  const slot = target.closest('[data-slot]')?.getAttribute('data-slot');
  return slot ? Number(slot) : -1;
}
