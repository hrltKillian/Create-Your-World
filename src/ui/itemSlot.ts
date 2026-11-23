import type { Registry } from '../content/registry.ts';
import { t } from '../i18n/i18n.ts';
import type { ItemStack } from '../sim/inventory.ts';
import { h } from './h.ts';

/** Read-only inventory slots (null: empty). */
export type Slots = readonly (Readonly<ItemStack> | null)[];

/** What slots need to draw items: the registry and the icon URLs by item id (empty until made). */
export interface ItemArt {
  readonly registry: Registry;
  icons: readonly string[];
}

/** Display name of a stack, with the tool's remaining uses when it is worn. */
export function stackName(art: ItemArt, stack: Readonly<ItemStack>): string {
  const id = art.registry.itemId(stack.item);
  if (id < 0) return stack.item;
  const name = t(art.registry.items[id]!.nameKey);
  if (stack.durability === undefined) return name;
  const max = art.registry.itemTables.durability[id]!;
  return t('slot.worn', { name, left: stack.durability, max });
}

/**
 * One inventory slot: icon, count (stackable items) and wear bar (worn tools). It only touches
 * the DOM when what it shows changes, so it can be refreshed often.
 */
export class SlotView {
  readonly element: HTMLElement;
  private readonly art: ItemArt;
  private readonly icon: HTMLImageElement;
  private readonly count: HTMLElement;
  private readonly wear: HTMLElement;
  private item: string | null = null;
  private icons: readonly string[] | null = null;
  private shownCount = -1;
  private shownWear = -1;

  /** `key`: the number shown in the corner (hotbar slots). */
  constructor(slot: number, art: ItemArt, key?: number) {
    this.art = art;
    this.icon = h('img', { class: 'slot-icon', attrs: { alt: '', draggable: 'false' } });
    this.icon.hidden = true;
    this.count = h('span', { class: 'slot-count' });
    this.wear = h('span', { class: 'slot-wear' }, h('span', { class: 'slot-wear-fill' }));
    this.wear.hidden = true;
    this.element = h(
      'div',
      { class: 'slot', attrs: { 'data-slot': String(slot) } },
      key === undefined ? null : h('span', { class: 'slot-key' }, key),
      this.icon,
      this.count,
      this.wear,
    );
  }

  set(stack: Readonly<ItemStack> | null): void {
    const registry = this.art.registry;
    const item = stack?.item ?? null;
    const id = item === null ? -1 : registry.itemId(item);
    if (item !== this.item || this.art.icons !== this.icons) {
      this.item = item;
      this.icons = this.art.icons;
      const url = id < 0 ? '' : (this.icons[id] ?? '');
      if (url) this.icon.src = url;
      this.icon.hidden = !url;
      this.element.classList.toggle('filled', item !== null);
    }
    const count = stack && id >= 0 && registry.itemTables.maxStack[id]! > 1 ? stack.count : 0;
    if (count !== this.shownCount) {
      this.shownCount = count;
      this.count.textContent = count > 0 ? String(count) : '';
    }
    const max = id >= 0 ? registry.itemTables.durability[id]! : 0;
    const wear = stack?.durability !== undefined && max > 0 ? stack.durability / max : -1;
    if (wear !== this.shownWear) {
      this.shownWear = wear;
      this.wear.hidden = wear < 0;
      if (wear >= 0) this.wear.style.setProperty('--wear', String(wear));
    }
  }
}
