import { tagNameKey } from '../content/items.ts';
import type { Registry } from '../content/registry.ts';
import type { TagKey } from '../content/schema.ts';
import { t } from '../i18n/i18n.ts';
import type { ItemStack } from '../sim/inventory.ts';
import { h } from './h.ts';

/** Read-only inventory slots (null: empty). */
export type Slots = readonly (Readonly<ItemStack> | null)[];

/** What slots need to draw items: the registry and the icon URLs by item id (empty until made). */
export interface ItemArt {
  readonly registry: Registry;
  icons: readonly string[];
  /** The avatar seen from the front (plan v5 « M51 »: the Bag's figure); '' until drawn. */
  figure: string;
}

/** Display name of a stack: an unknown item with its saved key, a worn tool with its uses left. */
export function stackName(art: ItemArt, stack: Readonly<ItemStack>): string {
  const id = art.registry.itemId(stack.item);
  if (id < 0) return stack.item;
  const name = t(art.registry.items[id]!.nameKey);
  if (stack.original !== undefined) return t('slot.unknown', { name, key: stack.original });
  if (stack.durability === undefined) return name;
  const max = art.registry.itemTables.durability[id]!;
  return t('slot.worn', { name, left: stack.durability, max });
}

/** Whether an ingredient key names a tag rather than an item. */
function isTag(key: string): key is TagKey {
  return key.startsWith('tag:');
}

/** Item id that pictures an ingredient: the item, or the first item carrying the tag (−1: none). */
export function ingredientItem(registry: Registry, key: string): number {
  if (!isTag(key)) return registry.itemId(key);
  return registry.items.findIndex((item) => item.tags?.includes(key));
}

/** Name of an item, or of a tag (« Any Log »). */
export function ingredientName(registry: Registry, key: string): string {
  if (isTag(key)) return t(tagNameKey(key));
  const id = registry.itemId(key);
  return id < 0 ? key : t(registry.items[id]!.nameKey);
}

/** A small icon of an item or tag (blank until the icons are made). */
export function itemIcon(art: ItemArt, key: string): HTMLImageElement {
  const img = h('img', { class: 'item-icon', attrs: { alt: '', draggable: 'false' } });
  const url = art.icons[ingredientItem(art.registry, key)] ?? '';
  if (url) img.src = url;
  return img;
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

  /**
   * `slot`: its number (`data-slot`), or null for the cursor stack's view; `key`: the number shown
   * in the corner (hotbar slots).
   */
  constructor(slot: number | null, art: ItemArt, key?: number) {
    this.art = art;
    this.icon = h('img', { class: 'slot-icon', attrs: { alt: '', draggable: 'false' } });
    this.icon.hidden = true;
    this.count = h('span', { class: 'slot-count' });
    this.wear = h('span', { class: 'slot-wear' }, h('span', { class: 'slot-wear-fill' }));
    this.wear.hidden = true;
    this.element = h(
      'div',
      { class: 'slot', attrs: slot === null ? {} : { 'data-slot': String(slot) } },
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
