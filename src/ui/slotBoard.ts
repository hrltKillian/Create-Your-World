import { HOTBAR_SLOTS } from '../core/player.ts';
import { t } from '../i18n/i18n.ts';
import type { Command } from '../sim/commands.ts';
import type { ItemStack } from '../sim/inventory.ts';
import { h } from './h.ts';
import { itemLines } from './itemInfo.ts';
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
  /** Inventory slots (hotbar then bag). */
  readonly slotCount: number;
  /**
   * First slot number of the open block entity's slots, or of the Bag's worn items (the
   * simulation's `OPEN_SLOTS_BASE`: past the largest inventory).
   */
  readonly openBase: number;
  /** Label of the key that opens and closes the screens, read at each opening. */
  readonly closeKey: () => string;
}

/**
 * The shell of a slot screen (Bag, Container, Station, Workbench): a full-screen section whose
 * `[data-slot]` views send the simulation's slot clicks (sim/slotClicks.ts decides): a left or
 * right button press on a slot, with Shift or not, one outside the panel (slot −1: throws the
 * cursor stack), and a hotbar number key over a slot. It only sends commands and shows what the
 * simulation answers: the slots, and the cursor stack (PlayerState.cursor) under the mouse.
 */
export class SlotBoard {
  readonly element: HTMLElement;
  /** Name of the hovered stack. */
  readonly caption: HTMLElement;
  private captionText = '';
  private readonly art: ItemArt;
  private readonly actions: ScreenActions;
  /** Inventory slots (hotbar then bag). */
  private readonly slotCount: number;
  private readonly closeHint: HTMLElement;
  private readonly closeKey: () => string;
  /** Views by slot number. */
  private readonly views: SlotView[] = [];
  /** The cursor stack's view, under the mouse (it ignores the pointer); hidden while it is empty. */
  private readonly cursor: SlotView;
  private slots: Slots = [];
  private hovered = -1;
  /** The pointer's last place in the viewport, where the cursor stack shows. */
  private pointerX = 0;
  private pointerY = 0;

  constructor(deps: ScreenDeps, id: string) {
    this.art = deps.art;
    this.actions = deps.actions;
    this.slotCount = deps.slotCount;
    this.closeKey = deps.closeKey;
    this.caption = h('p', { class: 'bag-caption' });
    this.closeHint = h('p', { class: 'bag-close' });
    this.cursor = new SlotView(null, deps.art);
    this.cursor.element.classList.add('slot-cursor');
    this.cursor.element.hidden = true;
    this.element = h(
      'section',
      {
        id,
        class: 'screen screen-slots',
        on: {
          pointerdown: this.onPointerDown,
          pointermove: this.onPointerMove,
          pointerover: this.onPointerOver,
          contextmenu: (event) => event.preventDefault(),
        },
      },
      this.cursor.element,
    );
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
    this.views.length = Math.min(this.views.length, from);
  }

  /** The bag (6×4), then the hotbar, with their views. */
  inventory(): HTMLElement[] {
    return [
      slotGrid(this.slotViews(HOTBAR_SLOTS, this.slotCount), BAG_COLUMNS),
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
    // A clicked button keeps the focus while hidden: Space or Enter would press it during play.
    const active = document.activeElement as HTMLElement | null | undefined;
    if (active && this.element.contains(active)) active.blur();
    this.element.hidden = true;
    this.hover(-1);
    this.actions.click();
  }

  /**
   * Shows the slots (the inventory, then the open block entity's) and the cursor stack: call when
   * they change and regularly; unchanged slots cost nothing.
   */
  update(slots: Slots, cursor: Readonly<ItemStack> | null): void {
    this.slots = slots;
    for (let i = 0; i < this.views.length; i++) this.views[i]?.set(slots[i] ?? null);
    if (this.hovered >= 0) this.hover(this.hovered);
    this.cursor.set(cursor);
    const view = this.cursor.element;
    if (view.hidden === (cursor !== null)) {
      view.hidden = cursor === null;
      this.placeCursor();
    }
  }

  /** A hotbar number key (slot 0–7) pressed while the screen is open, over the hovered slot. */
  hotkey(hotbarSlot: number): void {
    if (this.hovered >= 0)
      this.send({ type: 'slot.hotkey', slot: this.hovered, hotbar: hotbarSlot });
  }

  /** Sends a command with the click sound. */
  send(command: Command): void {
    this.actions.send(command);
    this.actions.click();
  }

  /** The hovered slot's item: its name, then its description (ui/itemInfo.ts). */
  private hover(slot: number): void {
    this.hovered = slot;
    const stack = slot >= 0 ? this.slots[slot] : null;
    const name = stack ? stackName(this.art, stack) : '';
    const lines = stack ? itemLines(this.art.registry, stack.item) : [];
    const text = [name, ...lines].join('\n');
    if (text === this.captionText) return;
    this.captionText = text;
    this.caption.replaceChildren(
      ...(name ? [h('strong', null, name)] : []),
      ...lines.map((line) => h('span', { class: 'caption-line' }, line)),
    );
  }

  /** Puts the cursor stack's view where the pointer last was (viewport pixels: main.css). */
  private placeCursor(): void {
    this.cursor.element.style.transform = `translate(${this.pointerX}px, ${this.pointerY}px)`;
  }

  private readonly onPointerOver = (event: PointerEvent): void => {
    this.hover(slotOf(event.target));
  };

  /** The cursor stack follows the pointer. */
  private readonly onPointerMove = (event: PointerEvent): void => {
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    if (!this.cursor.element.hidden) this.placeCursor();
  };

  /** A press on a slot clicks it; one outside the panel (the backdrop) is slot −1. */
  private readonly onPointerDown = (event: PointerEvent): void => {
    this.onPointerMove(event);
    if (event.button !== MOUSE_LEFT && event.button !== MOUSE_RIGHT) return;
    const slot = slotOf(event.target);
    const outside = event.target instanceof Element && !event.target.closest('.bag-panel');
    if (slot < 0 && !outside) return;
    event.preventDefault();
    const button = event.button === MOUSE_RIGHT ? 1 : 0;
    this.send({ type: 'slot.click', slot, button, shift: slot >= 0 && event.shiftKey });
  };
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
