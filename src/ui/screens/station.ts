import { fuelSlotOf, outputSlotOf, stationSlotCount } from '../../content/crafting.ts';
import type { Ingredient, ItemCount, ProcessDef, StationDef } from '../../content/schema.ts';
import { HOTBAR_SLOTS } from '../../core/player.ts';
import { t } from '../../i18n/i18n.ts';
import { h } from '../h.ts';
import { type ItemArt, ingredientName, itemIcon, type Slots } from '../itemSlot.ts';
import { type ScreenDeps, SlotBoard } from '../slotBoard.ts';

/** What a station shows besides its slots. */
export interface StationStatus {
  /** 0…1 left of the fuel item burning now (the flame). */
  readonly flame: number;
  /** 0…1 of the process under way. */
  readonly progress: number;
  /** Key of the process the inputs call for ('' when none). */
  readonly process: string;
}

/**
 * The Station screen (campfire, kiln, bloomery; docs « Écrans »): the inputs, the fuel slot under
 * its flame, the progress arrow, the output, and the processes the station runs (the one under way
 * lit), beside the bag and the hotbar. Slots take the bag's gestures; Shift+click sends fuel to the
 * fuel slot and anything else to the inputs.
 */
export class StationScreen {
  readonly element: HTMLElement;
  private readonly board: SlotBoard;
  private readonly art: ItemArt;
  private readonly base: number;
  private readonly title: HTMLElement;
  private readonly machine: HTMLElement;
  private readonly processes: HTMLElement;
  private readonly flame: HTMLElement;
  private readonly bar: HTMLElement;
  private station: StationDef | null = null;
  /** What the process list was drawn with (redrawn when either changes). */
  private shownProcess = '';
  private shownIcons: readonly string[] = [];

  constructor(deps: ScreenDeps) {
    const board = new SlotBoard(deps, 'station.move', 'screen-station');
    this.board = board;
    this.art = deps.art;
    this.base = deps.slotCount;
    this.element = board.element;
    this.title = h('h2');
    this.machine = h('div', { class: 'station-machine' });
    this.processes = h('ul', { class: 'station-processes' });
    this.flame = h('span', { class: 'flame' });
    this.bar = h('span', { class: 'station-bar' }, h('span', { class: 'station-bar-fill' }));
    this.element.append(
      h(
        'div',
        { class: 'bag-panel' },
        board.header(this.title),
        h(
          'div',
          { class: 'bag-columns' },
          h(
            'div',
            { class: 'station' },
            this.machine,
            h('p', { class: 'bag-section' }, t('station.processes')),
            this.processes,
          ),
          h(
            'div',
            { class: 'bag-inventory' },
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

  /** Shows a station named `title`, laid out from its definition. */
  open(station: StationDef, title: string): void {
    this.station = station;
    this.title.textContent = title;
    const board = this.board;
    const base = this.base;
    board.dropViews(base);
    const fuel = fuelSlotOf(station);
    const output = outputSlotOf(station);
    const parts = [
      part('station-inputs', 'station.inputs', board.slotViews(base, base + station.inputSlots)),
      h('span', { class: 'station-arrow' }, this.bar),
      part(
        'station-outputs',
        'station.output',
        board.slotViews(base + output, base + stationSlotCount(station)),
      ),
    ];
    if (fuel >= 0) {
      const slot = board.slotViews(base + fuel, base + fuel + 1);
      parts.push(part('station-fire', 'station.fuel', [this.flame, ...slot]));
    }
    this.machine.replaceChildren(...parts);
    this.drawProcesses('');
    board.open();
  }

  close(): void {
    this.board.close();
  }

  /** Shows the inventory, then the station's slots, its flame, progress and process. */
  update(slots: Slots, status: StationStatus): void {
    this.board.update(slots);
    this.flame.style.setProperty('--flame', String(status.flame));
    this.flame.classList.toggle('lit', status.flame > 0);
    this.bar.style.setProperty('--progress', String(status.progress));
    if (status.process !== this.shownProcess || this.art.icons !== this.shownIcons)
      this.drawProcesses(status.process);
  }

  hotkey(hotbarSlot: number): void {
    this.board.hotkey(hotbarSlot);
  }

  private drawProcesses(active: string): void {
    this.shownProcess = active;
    this.shownIcons = this.art.icons;
    const crafting = this.art.registry.crafting;
    const processes = this.station ? crafting.processesOf(this.station.key) : [];
    this.processes.replaceChildren(...processes.map((p) => this.processRow(p, p.key === active)));
  }

  /** Inputs → output, its time and what it burns. */
  private processRow(process: ProcessDef, active: boolean): HTMLElement {
    const fuel =
      process.fuel === 'charcoal'
        ? t('station.charcoalOnly')
        : process.fuel === 'none'
          ? t('station.noFuel')
          : '';
    return h(
      'li',
      { class: active ? 'station-process active' : 'station-process' },
      ...process.inputs.map((input) => this.stack(input)),
      h('span', { class: 'process-to' }),
      this.stack(process.output),
      h('span', { class: 'logbook-time' }, t('logbook.seconds', { n: process.seconds })),
      fuel ? h('span', { class: 'badge' }, fuel) : null,
    );
  }

  /** An item (or tag) and its count, named on hover. */
  private stack(stack: Ingredient | ItemCount): HTMLElement {
    const name = ingredientName(this.art.registry, stack.item);
    return h(
      'span',
      { class: 'process-item', attrs: { title: name } },
      itemIcon(this.art, stack.item),
      stack.count > 1 ? h('span', { class: 'slot-count' }, stack.count) : null,
    );
  }
}

/** A labelled group of slots. */
function part(className: string, labelKey: string, children: readonly HTMLElement[]): HTMLElement {
  return h(
    'div',
    { class: className },
    h('div', { class: 'station-slots' }, ...children),
    h('span', { class: 'station-label' }, t(labelKey)),
  );
}
