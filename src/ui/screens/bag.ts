import { WEAR_SLOTS } from '../../content/schema.ts';
import { HOTBAR_SLOTS } from '../../core/player.ts';
import { t } from '../../i18n/i18n.ts';
import type { Command } from '../../sim/commands.ts';
import type { Gear } from '../../sim/environment.ts';
import type { ItemStack } from '../../sim/inventory.ts';
import type { BestiaryRow } from '../bestiary.ts';
import { h } from '../h.ts';
import type { Slots } from '../itemSlot.ts';
import type { QuestRow, TaskRow } from '../quests.ts';
import { type ScreenActions, type ScreenDeps, SlotBoard } from '../slotBoard.ts';
import type { StatusView } from '../status.ts';
import { BestiaryPanel } from './bestiaryPanel.ts';
import type { LogbookPanel, LogbookState } from './logbook.ts';
import { menuButton } from './menuParts.ts';
import { QuestsPanel } from './questsPanel.ts';
import { StatusPanel } from './statusPanel.ts';

/** The Bag's pages (its tab bar), each opened by the key of the action of its name. */
export const BAG_PAGES = ['inventory', 'logbook', 'bestiary', 'quests', 'status'] as const;
export type BagPage = (typeof BAG_PAGES)[number];

/**
 * The Bag (E or Tab, docs « Écrans »): a tab bar over five pages beside the 6×4 bag and the hotbar,
 * the Inventory (the silhouette, its 5 equipment slots: slots 64–68 of the slot clicks, a wearable
 * only in its own, and what the worn items protect from), the Logbook of the hand recipes, the
 * Bestiary (ui/bestiary.ts), the Quests (ui/quests.ts) and the Status (ui/status.ts). It opens on
 * the page of the key pressed (plan v3 « M18 », « M21 », « M22 »).
 */
export class BagScreen {
  readonly element: HTMLElement;
  readonly logbook: LogbookPanel;
  readonly bestiary = new BestiaryPanel();
  readonly quests: QuestsPanel;
  readonly status: StatusPanel;
  private readonly board: SlotBoard;
  private readonly actions: ScreenActions;
  private readonly protection: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly pages: Readonly<Record<BagPage, HTMLElement>>;
  private page: BagPage = 'inventory';

  constructor(deps: ScreenDeps, logbook: LogbookPanel) {
    this.logbook = logbook;
    const board = new SlotBoard(deps, 'screen-bag');
    this.board = board;
    this.actions = deps.actions;
    this.quests = new QuestsPanel(deps.actions);
    this.status = new StatusPanel(deps.actions);
    this.element = board.element;
    this.protection = h('p', { class: 'wear-stats' });
    const worn = board.slotViews(deps.openBase, deps.openBase + WEAR_SLOTS.length);
    this.pages = {
      inventory: wearColumn(worn, this.protection),
      logbook: logbook.element,
      bestiary: this.bestiary.element,
      quests: this.quests.element,
      status: this.status.element,
    };
    this.tabs = h('nav', { class: 'bag-tabs' });
    // Inventory comfort (plan v3 « M32 »): the bag sorted, its items stacked into chests nearby.
    const sort = menuButton(
      'bag-sort',
      t('bag.sort'),
      () => this.send({ type: 'inv.sort', open: false }),
      'quest-pin',
    );
    const stack = menuButton(
      'stack-nearby',
      t('bag.stackNearby'),
      () => this.send({ type: 'inv.stackNearby' }),
      'quest-pin',
    );
    this.element.append(
      h(
        'div',
        { class: 'bag-panel' },
        board.header(h('h2', null, t('bag.title'))),
        this.tabs,
        h(
          'div',
          { class: 'bag-columns' },
          this.pages.inventory,
          this.pages.logbook,
          this.pages.bestiary,
          this.pages.quests,
          this.pages.status,
          h(
            'div',
            { class: 'bag-inventory' },
            h('div', { class: 'bag-tools' }, sort, stack),
            ...board.inventory(),
          ),
        ),
        h('p', { class: 'bag-help' }, t('bag.help', { first: 1, last: HOTBAR_SLOTS })),
      ),
    );
    this.show(this.page);
  }

  isOpen(): boolean {
    return this.board.isOpen();
  }

  /** Opens on a page (the one its key names). */
  open(page: BagPage = 'inventory'): void {
    this.show(page);
    this.board.open();
  }

  close(): void {
    this.board.close();
  }

  /** The page on show. */
  shown(): BagPage {
    return this.page;
  }

  /** Shows a page and lights its tab. */
  show(page: BagPage): void {
    this.page = page;
    for (const name of BAG_PAGES) this.pages[name].hidden = name !== page;
    this.tabs.replaceChildren(...BAG_PAGES.map((name) => this.tab(name)));
  }

  /**
   * Shows the inventory then the worn items, the cursor stack, their protection, the Logbook, the
   * Bestiary, the Quests and the Status (call when they change and regularly).
   */
  update(
    slots: Slots,
    cursor: Readonly<ItemStack> | null,
    logbook: LogbookState,
    gear: Readonly<Gear>,
    bestiary: readonly BestiaryRow[],
    quests: readonly QuestRow[],
    tasks: readonly TaskRow[],
    status: StatusView,
  ): void {
    this.board.update(slots, cursor);
    const text = t('wear.stats', { armor: gear.armor, warmth: gear.warmth, cooling: gear.cooling });
    if (this.protection.textContent !== text) this.protection.textContent = text;
    this.logbook.update(logbook);
    this.bestiary.update(bestiary);
    this.quests.update(quests, tasks);
    this.status.update(status);
  }

  private send(command: Command): void {
    this.actions.click();
    this.actions.send(command);
  }

  /** A hotbar number key (slot 0–7) pressed while the bag is open. */
  hotkey(hotbarSlot: number): void {
    this.board.hotkey(hotbarSlot);
  }

  private tab(page: BagPage): HTMLElement {
    return h(
      'button',
      {
        class: page === this.page ? 'bag-tab active' : 'bag-tab',
        attrs: { type: 'button', 'data-page': page, 'aria-pressed': String(page === this.page) },
        on: {
          click: () => {
            if (page === this.page) return;
            this.show(page);
            this.actions.click();
          },
        },
      },
      t(`bag.tab.${page}`),
    );
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
