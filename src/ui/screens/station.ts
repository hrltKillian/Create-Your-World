import { fuelSlotOf, outputSlotOf, stationSlotCount } from '../../content/crafting.ts';
import type { Ingredient, ItemCount, ProcessDef, StationDef } from '../../content/schema.ts';
import { t } from '../../i18n/i18n.ts';
import type { ItemStack } from '../../sim/inventory.ts';
import { h } from '../h.ts';
import { type ItemArt, ingredientName, itemIcon, type Slots } from '../itemSlot.ts';
import { type ScreenDeps, SlotBoard } from '../slotBoard.ts';
import { menuButton } from './menuParts.ts';

/** What a station shows besides its slots. */
export interface StationStatus {
  /** The fire burned during the last tick (a banked fire with fuel left shows dim). */
  readonly lit: boolean;
  /** 0…1 left of the fuel item lit last (the flame's size). */
  readonly flame: number;
  /** 0…1 of the process under way. */
  readonly progress: number;
  /** Key of the process the inputs call for ('' when none). */
  readonly process: string;
  /** The fire is kept burning without a process (the « Keep burning » toggle). */
  readonly keepLit: boolean;
}

/**
 * The Station screen (campfire, kiln, bloomery; docs « Écrans »): the inputs, the fuel slot under
 * its flame, the progress arrow, the output, the « Keep burning » toggle of a fire that allows it
 * (the campfire: warmth and light without a process), and the processes the station runs (the one
 * under way lit), beside the bag and the hotbar. Slots take the slot clicks; Shift+click sends
 * fuel the fire burns to the fuel slot and the ingredients of its processes to the inputs (the
 * simulation decides, and the toggle shows what it keeps).
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
  private readonly keepLit: HTMLButtonElement;
  private station: StationDef | null = null;
  /** What the process list was drawn with (redrawn when either changes). */
  private shownProcess = '';
  private shownIcons: readonly string[] = [];

  constructor(deps: ScreenDeps) {
    const board = new SlotBoard(deps, 'screen-station');
    this.board = board;
    this.art = deps.art;
    this.base = deps.openBase;
    this.element = board.element;
    this.title = h('h2');
    this.machine = h('div', { class: 'station-machine' });
    this.processes = h('ul', { class: 'station-processes' });
    this.flame = h('span', { class: 'flame' });
    this.bar = h('span', { class: 'station-bar' }, h('span', { class: 'station-bar-fill' }));
    this.keepLit = menuButton('keep-lit', t('station.keepLit'), () => {
      deps.actions.sound('button');
      // A flip in the simulation: the state shown here may be a refresh behind (UiBridge).
      deps.actions.send({ type: 'station.keepLit' });
    });
    this.keepLit.classList.add('station-keep-lit');
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
            this.keepLit,
            h('p', { class: 'bag-section' }, t('station.processes')),
            this.processes,
          ),
          h('div', { class: 'bag-inventory' }, ...board.inventory(true)),
        ),
        board.help(),
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
    this.keepLit.hidden = station.keepLit !== true;
    this.drawProcesses('');
    board.open();
  }

  close(): void {
    this.board.close();
  }

  /**
   * Shows the inventory, then the station's slots, the cursor stack, its flame, progress and
   * process.
   */
  update(slots: Slots, cursor: Readonly<ItemStack> | null, status: StationStatus): void {
    this.board.update(slots, cursor);
    this.flame.style.setProperty('--flame', String(status.flame));
    this.flame.classList.toggle('lit', status.lit);
    this.bar.style.setProperty('--progress', String(status.progress));
    this.keepLit.classList.toggle('on', status.keepLit);
    this.keepLit.setAttribute('aria-pressed', String(status.keepLit));
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
          : process.fuel === 'rain'
            ? t('station.rainOnly')
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
