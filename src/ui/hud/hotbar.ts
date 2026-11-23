import { HOTBAR_SLOTS } from '../../core/player.ts';
import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';
import { type ItemArt, type Slots, SlotView } from '../itemSlot.ts';

/** The 8-slot tray at the bottom centre: icons, counts, wear, key numbers and the selected slot. */
export class Hotbar {
  readonly element: HTMLElement;
  /** Slot drawn as selected (−1 before the first update). */
  selected = -1;
  private readonly slots: SlotView[];

  constructor(art: ItemArt) {
    this.slots = Array.from({ length: HOTBAR_SLOTS }, (_, i) => new SlotView(i, art, i + 1));
    this.element = h(
      'div',
      { id: 'hotbar', class: 'hotbar', attrs: { 'aria-label': t('hud.hotbar') } },
      ...this.slots.map((slot) => slot.element),
    );
  }

  update(inventory: Slots, selected: number): void {
    for (let i = 0; i < HOTBAR_SLOTS; i++) this.slots[i]!.set(inventory[i] ?? null);
    if (selected === this.selected) return;
    this.slots[this.selected]?.element.classList.remove('selected');
    this.slots[selected]?.element.classList.add('selected');
    this.selected = selected;
  }
}
