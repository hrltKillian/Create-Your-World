import { RECIPE_CATEGORIES, type RecipeCategory } from '../../content/schema.ts';
import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';
import { type ItemArt, ingredientName, itemIcon } from '../itemSlot.ts';
import {
  batchCount,
  CRAFT_BATCHES,
  type CraftBatch,
  hiddenRecipes,
  type IngredientPip,
  type LogbookSource,
  logbookRows,
  pipFilled,
  type RecipeRow,
  stationRecipes,
} from '../logbook.ts';
import type { ScreenActions } from '../slotBoard.ts';
import { menuButton } from './menuParts.ts';

/** A queue entry as the Logbook shows it. */
export interface QueueView {
  readonly recipe: string;
  /** Crafts left in the entry. */
  readonly count: number;
  /** 0…1 of the craft in progress (the first entry). */
  readonly progress: number;
}

export interface LogbookState {
  readonly source: LogbookSource;
  readonly queue: readonly QueueView[];
}

export interface LogbookLimits {
  /** Queue entries (5). */
  readonly queue: number;
  /** Most crafts one command queues (the Max button). */
  readonly maxCount: number;
}

/**
 * The Logbook (the Bag's: the hand recipes and the player's queue; a Workbench's: its station's
 * recipes and the bench's queue): tabs, the revealed recipes with craftable ones first, each with
 * its owned/required pips; the selected recipe's ingredients (with where an unseen one is found)
 * and the ×1/×5/Max buttons (on for what the inventory pays for and the queue takes); then the
 * queue of 5, whose entries cancel on a click, and what is left: the recipes still to discover,
 * and in the Bag the ones made at a station (« 3 more at the Workbench »). Rebuilt only when what
 * it shows changes.
 */
export class LogbookPanel {
  readonly element: HTMLElement;
  private readonly art: ItemArt;
  private readonly actions: ScreenActions;
  private readonly limits: LogbookLimits;
  private readonly tabs: HTMLElement;
  private readonly list: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly queueLabel: HTMLElement;
  private readonly queue: HTMLElement;
  private readonly footer: HTMLElement;
  private tab: RecipeCategory = RECIPE_CATEGORIES[0]!;
  private selected = '';
  private state: LogbookState | null = null;
  private signature = '';
  private progress: HTMLElement | null = null;

  constructor(art: ItemArt, actions: ScreenActions, limits: LogbookLimits) {
    this.art = art;
    this.actions = actions;
    this.limits = limits;
    this.tabs = h('nav', { class: 'logbook-tabs' });
    this.list = h('div', { class: 'logbook-list' });
    this.detail = h('div', { class: 'logbook-detail' });
    this.queueLabel = h('p', { class: 'bag-section' });
    this.queue = h('div', { class: 'logbook-queue' });
    this.footer = h('p', { class: 'logbook-footer' });
    this.element = h(
      'div',
      { class: 'logbook' },
      h('p', { class: 'bag-section' }, t('logbook.title')),
      this.tabs,
      this.list,
      this.detail,
      this.queueLabel,
      this.queue,
      this.footer,
    );
  }

  /** Shows the player's recipes and queue (call when the bag is open; cheap when nothing changed). */
  update(state: LogbookState): void {
    this.state = state;
    const rows = logbookRows(state.source, this.limits.maxCount);
    const footer = this.footerText(state.source);
    const signature = this.signatureOf(rows, state.queue, footer);
    if (signature !== this.signature) {
      this.signature = signature;
      this.render(rows, state.queue, footer);
    }
    this.progress?.style.setProperty('--progress', String(state.queue[0]?.progress ?? 0));
  }

  private refresh(): void {
    this.actions.click();
    this.signature = '';
    if (this.state) this.update(this.state);
  }

  /** Everything the panel shows but the progress bar. */
  private signatureOf(rows: readonly RecipeRow[], queue: readonly QueueView[], footer: string) {
    const parts = [this.tab, this.selected, this.art.icons.length, footer];
    for (const entry of queue) parts.push(entry.recipe, entry.count);
    for (const row of rows) {
      parts.push(row.recipe.key, row.max, row.room);
      for (const pip of row.pips) parts.push(pip.owned, Number(pip.seen));
    }
    return parts.join('|');
  }

  /** The recipes still to discover, then (in the Bag) those made at a station, by station. */
  private footerText(source: LogbookSource): string {
    const hidden = hiddenRecipes(source);
    const parts = hidden > 0 ? [t('logbook.hidden', { n: hidden })] : [];
    for (const { station, count } of stationRecipes(source))
      parts.push(t('logbook.atStation', { n: count, station: this.stationName(station) }));
    return parts.join(' · ');
  }

  private render(rows: readonly RecipeRow[], queue: readonly QueueView[], footer: string): void {
    this.tabs.replaceChildren(
      ...RECIPE_CATEGORIES.map((category) => this.tabButton(category, rows)),
    );
    const shown = rows.filter((row) => row.recipe.category === this.tab);
    this.list.replaceChildren(
      ...(shown.length > 0
        ? shown.map((row) => this.rowButton(row))
        : [h('p', { class: 'logbook-empty' }, t('logbook.empty'))]),
    );
    const selected = shown.find((row) => row.recipe.key === this.selected);
    this.detail.replaceChildren(
      ...(selected
        ? this.details(selected)
        : [h('p', { class: 'logbook-empty' }, t('logbook.pick'))]),
    );
    this.queueLabel.textContent = t('logbook.queue', { n: queue.length, max: this.limits.queue });
    this.progress = null;
    const entries: HTMLElement[] = [];
    for (let i = 0; i < this.limits.queue; i++) entries.push(this.queueEntry(queue[i], i));
    this.queue.replaceChildren(...entries);
    this.footer.textContent = footer;
  }

  private tabButton(category: RecipeCategory, rows: readonly RecipeRow[]): HTMLElement {
    let craftable = 0;
    for (const row of rows) if (row.craftable && row.recipe.category === category) craftable++;
    return h(
      'button',
      {
        class: category === this.tab ? 'logbook-tab active' : 'logbook-tab',
        attrs: { type: 'button', 'data-tab': category },
        on: {
          click: () => {
            this.tab = category;
            this.selected = '';
            this.refresh();
          },
        },
      },
      t(`logbook.tab.${category}`),
      craftable > 0 ? h('span', { class: 'logbook-count' }, craftable) : null,
    );
  }

  private rowButton(row: RecipeRow): HTMLElement {
    const recipe = row.recipe;
    const classes = ['logbook-row'];
    if (row.craftable) classes.push('craftable');
    if (recipe.key === this.selected) classes.push('selected');
    return h(
      'button',
      {
        class: classes.join(' '),
        attrs: { type: 'button', 'data-recipe': recipe.key },
        on: {
          click: () => {
            this.selected = recipe.key;
            this.refresh();
          },
        },
      },
      itemIcon(this.art, recipe.output.item),
      h(
        'span',
        { class: 'logbook-row-text' },
        h('span', { class: 'logbook-name' }, this.outputName(row)),
        h('span', { class: 'logbook-pips' }, ...row.pips.map((pip) => this.pip(pip))),
      ),
    );
  }

  /** Name of a recipe's output, with its count when it makes several. */
  private outputName(row: RecipeRow): string {
    const { item, count } = row.recipe.output;
    const name = ingredientName(this.art.registry, item);
    return count > 1 ? t('logbook.makes', { name, n: count }) : name;
  }

  private pip(pip: IngredientPip): HTMLElement {
    return h(
      'span',
      { class: pipFilled(pip) ? 'pip filled' : 'pip' },
      itemIcon(this.art, pip.key),
      t('logbook.pip', { owned: pip.owned, required: pip.required }),
    );
  }

  private stationName(key: string): string {
    const station = this.art.registry.crafting.station(key);
    return station ? t(station.nameKey) : key;
  }

  private details(row: RecipeRow): HTMLElement[] {
    const recipe = row.recipe;
    const out: HTMLElement[] = [
      h(
        'p',
        { class: 'logbook-title' },
        itemIcon(this.art, recipe.output.item),
        h('strong', null, this.outputName(row)),
        h('span', { class: 'logbook-time' }, t('logbook.seconds', { n: recipe.seconds })),
      ),
      h('ul', { class: 'logbook-ingredients' }, ...row.pips.map((pip) => this.ingredient(pip))),
      h(
        'div',
        { class: 'logbook-batches' },
        ...CRAFT_BATCHES.map((batch) => this.batchButton(batch, row)),
      ),
    ];
    return out;
  }

  /** ×1, ×5 or Max: queues that many crafts of the row's recipe (disabled when it cannot). */
  private batchButton(batch: CraftBatch, row: RecipeRow): HTMLElement {
    const count = batchCount(batch, row);
    const recipe = row.recipe.key;
    const button = menuButton(
      `craft-${batch}`,
      t(`logbook.batch.${batch}`),
      () => {
        this.actions.send({ type: 'craft.enqueue', recipe, count });
        this.actions.click();
      },
      'button secondary logbook-batch',
    );
    button.disabled = count === 0;
    return button;
  }

  /** An ingredient line: icon, name and pip; where it is found while it has never been seen. */
  private ingredient(pip: IngredientPip): HTMLElement {
    const registry = this.art.registry;
    const hint = pip.seen ? undefined : registry.item(pip.key)?.hintKey;
    const icon = itemIcon(this.art, pip.key);
    if (!pip.seen) icon.classList.add('unseen');
    return h(
      'li',
      { class: pipFilled(pip) ? 'filled' : '' },
      icon,
      h('span', { class: 'logbook-ingredient' }, ingredientName(registry, pip.key)),
      h(
        'span',
        { class: 'pip-count' },
        t('logbook.pip', { owned: pip.owned, required: pip.required }),
      ),
      hint ? h('span', { class: 'logbook-hint' }, t(hint)) : null,
    );
  }

  /** A queue slot: the entry's output and crafts left (a click cancels it), or an empty box. */
  private queueEntry(entry: QueueView | undefined, index: number): HTMLElement {
    if (!entry) return h('div', { class: 'queue-entry empty' });
    const recipe = this.art.registry.crafting.recipe(entry.recipe);
    const bar = h('span', { class: 'queue-progress' });
    if (index === 0) this.progress = bar;
    return h(
      'button',
      {
        class: index === 0 ? 'queue-entry active' : 'queue-entry',
        attrs: { type: 'button', 'data-queue': String(index), title: t('logbook.cancel') },
        on: {
          click: () => {
            // A station's Logbook shows the open workbench's queue.
            const workbench = this.state?.source.station !== undefined;
            this.actions.send({ type: 'craft.cancel', index, ...(workbench ? { workbench } : {}) });
            this.actions.click();
          },
        },
      },
      recipe ? itemIcon(this.art, recipe.output.item) : null,
      entry.count > 1 ? h('span', { class: 'slot-count' }, entry.count) : null,
      index === 0 ? bar : null,
    );
  }
}
