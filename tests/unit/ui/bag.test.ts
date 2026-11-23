import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { RECIPE_CATEGORIES, WEAR_SLOTS } from '../../../src/content/schema.ts';
import { addStrings, i18nMissing } from '../../../src/i18n/i18n.ts';
import type { Command } from '../../../src/sim/commands.ts';
import { CRAFT_QUEUE, MAX_CRAFT_COUNT } from '../../../src/sim/craftQueue.ts';
import { INVENTORY_SLOTS, type Inventory } from '../../../src/sim/inventory.ts';
import type { LogbookSource } from '../../../src/ui/logbook.ts';
import { BagScreen } from '../../../src/ui/screens/bag.ts';
import { ContainerScreen } from '../../../src/ui/screens/container.ts';
import { LogbookPanel, type QueueView } from '../../../src/ui/screens/logbook.ts';
import { StationScreen } from '../../../src/ui/screens/station.ts';
import type { ScreenDeps } from '../../../src/ui/slotBoard.ts';
import { type FakeElement, installFakeDom, removeFakeDom } from '../../helpers/fakeDom.ts';
import { registry } from '../../helpers/registry.ts';

beforeEach(installFakeDom);
afterEach(removeFakeDom);
addStrings(basePack.strings);

const LIMITS = { queue: CRAFT_QUEUE, maxCount: MAX_CRAFT_COUNT };

function deps(label = () => 'E') {
  const sent: Command[] = [];
  const screen: ScreenDeps = {
    art: { registry, icons: [] },
    actions: { send: (command) => sent.push(command), click: () => {} },
    slotCount: INVENTORY_SLOTS,
    closeKey: label,
  };
  return { screen, sent };
}

const fake = (element: HTMLElement) => element as unknown as FakeElement;
const byAttr = (root: HTMLElement, name: string, value?: string) =>
  fake(root).findAll(
    (e) => e.getAttribute(name) !== null && (value === undefined || e.getAttribute(name) === value),
  );
const slotNumbers = (root: HTMLElement) =>
  byAttr(root, 'data-slot').map((e) => Number(e.getAttribute('data-slot')));

function logbookSource(owned: Record<string, number>): LogbookSource {
  const seen: Record<string, boolean> = {};
  for (const key of Object.keys(owned)) seen[key] = true;
  return {
    crafting: registry.crafting,
    seen,
    owned: (ingredient) => owned[ingredient] ?? 0,
    stationNear: () => false,
  };
}

describe('BagScreen', () => {
  it('shows the close key as labelled when it opens (the layout map loads after boot)', () => {
    let label = 'E';
    const { screen } = deps(() => label);
    const bag = new BagScreen(screen, new LogbookPanel(screen.art, screen.actions, LIMITS));
    const hint = () => fake(bag.element).querySelector('.bag-close');
    bag.open();
    expect(hint()?.textContent).toBe('E or Esc to close');
    bag.close();
    label = 'Ê';
    bag.open();
    expect(hint()?.textContent).toBe('Ê or Esc to close');
  });

  it('has the 32 inventory slots and the 5 equipment slots of the silhouette', () => {
    const { screen } = deps();
    const bag = new BagScreen(screen, new LogbookPanel(screen.art, screen.actions, LIMITS));
    expect(slotNumbers(bag.element).sort((a, b) => a - b)).toEqual(
      Array.from({ length: INVENTORY_SLOTS + WEAR_SLOTS.length }, (_, i) => i),
    );
    expect(byAttr(bag.element, 'data-wear').map((e) => e.getAttribute('data-wear'))).toEqual(
      WEAR_SLOTS,
    );
    // Each box of the silhouette is the slot of its worn item, from 32 on.
    const boxes = byAttr(bag.element, 'data-wear').map((box) => slotNumbers(box as never));
    expect(boxes).toEqual(WEAR_SLOTS.map((_, i) => [INVENTORY_SLOTS + i]));
  });

  it('takes only a wearable in its own equipment slot (right-drag splits)', () => {
    const { screen } = deps();
    const bag = new BagScreen(screen, new LogbookPanel(screen.art, screen.actions, LIMITS));
    const head = INVENTORY_SLOTS + WEAR_SLOTS.indexOf('head');
    const body = INVENTORY_SLOTS + WEAR_SLOTS.indexOf('body');
    expect(bag.accepts(head, 'item:fur_hood')).toBe(true);
    expect(bag.accepts(body, 'item:fur_hood')).toBe(false);
    expect(bag.accepts(head, 'item:broadleaf_log')).toBe(false);
  });

  it('shows what the worn items protect from', () => {
    const { screen } = deps();
    const bag = new BagScreen(screen, new LogbookPanel(screen.art, screen.actions, LIMITS));
    const slots: Inventory = new Array(INVENTORY_SLOTS + WEAR_SLOTS.length).fill(null);
    slots[9] = { item: 'item:fur_hood', count: 1 };
    const gear = { armor: 3, warmth: 16, cooling: 0, airFilter: 1, waterproof: false };
    bag.update(slots, { source: logbookSource({}), queue: [] }, gear);
    expect(fake(bag.element).querySelector('.wear-stats')?.textContent).toBe(
      'Armor 3 · Warmth +16 °C · Cooling −0 °C',
    );
  });
});

describe('LogbookPanel', () => {
  function panel() {
    const { screen, sent } = deps();
    const logbook = new LogbookPanel(screen.art, screen.actions, LIMITS);
    return { logbook, sent, root: logbook.element };
  }
  const tools = { 'item:flint': 2, 'item:stick': 2, 'item:cord': 1 };

  it('lists a tab craftable first, and a selected recipe queues ×1, ×5 or Max', () => {
    const { logbook, sent, root } = panel();
    logbook.update({ source: logbookSource(tools), queue: [] });
    byAttr(root, 'data-tab', 'tools')[0]!.dispatch('click');
    const rows = byAttr(root, 'data-recipe').map((e) => e.getAttribute('data-recipe'));
    expect(rows.slice(0, 3)).toEqual([
      'recipe:flint_knife',
      'recipe:flint_hatchet',
      'recipe:flint_pickaxe',
    ]);
    byAttr(root, 'data-recipe', 'recipe:flint_hatchet')[0]!.dispatch('click');
    const button = (batch: string) =>
      byAttr(root, 'data-action', `craft-${batch}`)[0] as FakeElement & { disabled?: boolean };
    expect(button('1').disabled).toBe(false);
    expect(button('5').disabled).toBe(true);
    button('1').dispatch('click');
    button('max').dispatch('click');
    expect(sent).toEqual([
      { type: 'craft.enqueue', recipe: 'recipe:flint_hatchet', count: 1 },
      { type: 'craft.enqueue', recipe: 'recipe:flint_hatchet', count: 1 },
    ]);
  });

  it('says which station a recipe needs, and shows where an unseen ingredient is found', () => {
    const { logbook, root } = panel();
    logbook.update({ source: logbookSource({ 'item:planks': 8 }), queue: [] });
    byAttr(root, 'data-tab', 'building')[0]!.dispatch('click');
    byAttr(root, 'data-recipe', 'recipe:chest')[0]!.dispatch('click');
    expect(fake(root).querySelector('.logbook-requires')?.textContent).toBe(
      'Requires: Workbench nearby',
    );
    expect(fake(root).querySelector('.badge')?.textContent).toBe('Workbench');
    byAttr(root, 'data-tab', 'survival')[0]!.dispatch('click');
    byAttr(root, 'data-recipe', 'recipe:unfired_flask')[0]!.dispatch('click');
    expect(fake(root).querySelector('.logbook-hint')?.textContent).toBe(
      'Dug from clay banks along the shores',
    );
  });

  it('shows the queue of 5, the first entry with its progress, and cancels on a click', () => {
    const { logbook, sent, root } = panel();
    const queue: QueueView[] = [
      { recipe: 'recipe:cord', count: 2, progress: 0.5 },
      { recipe: 'recipe:stick', count: 1, progress: 0 },
    ];
    logbook.update({ source: logbookSource({}), queue });
    const entries = fake(root).findAll((e) => e.className.split(' ').includes('queue-entry'));
    expect(entries).toHaveLength(CRAFT_QUEUE);
    expect(entries.filter((e) => e.className.includes('empty'))).toHaveLength(CRAFT_QUEUE - 2);
    byAttr(root, 'data-queue', '1')[0]!.dispatch('click');
    expect(sent).toEqual([{ type: 'craft.cancel', index: 1 }]);
  });

  it('has a string for every tab, recipe and ingredient it can show', () => {
    const { logbook, root } = panel();
    const everything: Record<string, number> = {};
    for (const item of registry.items) {
      everything[item.key] = 1;
      for (const tag of item.tags ?? []) everything[tag] = 1;
    }
    logbook.update({ source: logbookSource(everything), queue: [] });
    let shown = 0;
    for (const category of RECIPE_CATEGORIES) {
      byAttr(root, 'data-tab', category)[0]!.dispatch('click');
      for (const row of byAttr(root, 'data-recipe')) {
        row.dispatch('click');
        shown++;
      }
    }
    expect(shown).toBe(registry.crafting.recipes.length);
    expect(i18nMissing()).toEqual([]);
  });
});

describe('ContainerScreen', () => {
  it('numbers the chest slots after the inventory; Take all and Store all send one move per stack', () => {
    const { screen, sent } = deps();
    const chest = new ContainerScreen(screen);
    chest.open('Chest', 18);
    expect(Math.max(...slotNumbers(chest.element))).toBe(INVENTORY_SLOTS + 17);
    const slots: Inventory = new Array(INVENTORY_SLOTS + 18).fill(null);
    slots[0] = { item: 'item:dirt', count: 3 };
    slots[9] = { item: 'item:dirt', count: 4 };
    slots[INVENTORY_SLOTS + 2] = { item: 'item:flint', count: 1 };
    chest.update(slots);
    byAttr(chest.element, 'data-action', 'take-all')[0]!.dispatch('click');
    byAttr(chest.element, 'data-action', 'store-all')[0]!.dispatch('click');
    expect(sent).toEqual([
      { type: 'container.move', from: INVENTORY_SLOTS + 2 },
      { type: 'container.move', from: 9 },
    ]);
    // A second opening makes the chest's views again (another size, no duplicates).
    chest.close();
    chest.open('Chest', 6);
    expect(slotNumbers(chest.element)).toHaveLength(INVENTORY_SLOTS + 6);
  });
});

describe('StationScreen', () => {
  it('lays out inputs, fuel and output from the station, lists its processes and lights the flame', () => {
    const { screen } = deps();
    const station = new StationScreen(screen);
    const kiln = registry.crafting.station('station:kiln')!;
    station.open(kiln, 'Clay Kiln');
    const base = INVENTORY_SLOTS;
    const machine = fake(station.element).querySelector('.station-machine')!;
    const inMachine = (cls: string) =>
      slotNumbers(machine.querySelector(cls) as unknown as HTMLElement);
    expect(inMachine('.station-inputs')).toEqual([base, base + 1]);
    expect(inMachine('.station-fire')).toEqual([base + 2]);
    expect(inMachine('.station-outputs')).toEqual([base + 3]);
    const rows = fake(station.element).findAll(
      (e) => e.className.split(' ')[0] === 'station-process',
    );
    expect(rows).toHaveLength(registry.crafting.processesOf('station:kiln').length);
    const slots: Inventory = new Array(base + 4).fill(null);
    const flame = () => fake(station.element).querySelector('.flame')!;
    const burning = { lit: true, flame: 0.5, progress: 0.25, process: 'process:copper_ingot' };
    station.update(slots, burning);
    expect(flame().className).toBe('flame lit');
    const active = fake(station.element).findAll((e) => e.className === 'station-process active');
    expect(active).toHaveLength(1);
    // A banked fire (idle, fuel time left) is dim: its size stays, it is not lit.
    station.update(slots, { lit: false, flame: 0.5, progress: 0, process: '' });
    expect(flame().className).toBe('flame');
    expect(flame().style.getPropertyValue('--flame')).toBe('0.5');
    station.update(slots, { lit: false, flame: 0, progress: 0, process: '' });
    expect(flame().className).toBe('flame');
  });

  it('tells which items its slots take, from the station layout (right-drag splits)', () => {
    const { screen } = deps();
    const station = new StationScreen(screen);
    const base = INVENTORY_SLOTS;
    expect(station.accepts(base, 'item:copper_ore')).toBe(false); // nothing open yet
    station.open(registry.crafting.station('station:bloomery')!, 'Bloomery');
    // The bloomery: its input, its fuel slot (charcoal only), its output.
    expect(station.accepts(base, 'item:broadleaf_log')).toBe(true);
    expect(station.accepts(base + 1, 'item:charcoal')).toBe(true);
    expect(station.accepts(base + 1, 'item:broadleaf_log')).toBe(false);
    expect(station.accepts(base + 2, 'item:charcoal')).toBe(false);
    station.open(registry.crafting.station('station:kiln')!, 'Clay Kiln');
    expect(station.accepts(base + 2, 'item:broadleaf_log')).toBe(true);
    expect(station.accepts(base + 2, 'item:copper_ore')).toBe(false);
  });
});
