import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { RECIPE_CATEGORIES, WEAR_SLOTS } from '../../../src/content/schema.ts';
import { addStrings, i18nMissing } from '../../../src/i18n/i18n.ts';
import { type Command, OPEN_SLOTS_BASE } from '../../../src/sim/commands.ts';
import { CRAFT_QUEUE, MAX_CRAFT_COUNT } from '../../../src/sim/craftQueue.ts';
import { BASE_INVENTORY_SLOTS, type Inventory } from '../../../src/sim/inventory.ts';
import type { LogbookSource } from '../../../src/ui/logbook.ts';
import { BagScreen } from '../../../src/ui/screens/bag.ts';
import { ContainerScreen } from '../../../src/ui/screens/container.ts';
import { LogbookPanel, type QueueView } from '../../../src/ui/screens/logbook.ts';
import { StationScreen } from '../../../src/ui/screens/station.ts';
import { WorkbenchScreen } from '../../../src/ui/screens/workbench.ts';
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
    slotCount: BASE_INVENTORY_SLOTS,
    openBase: OPEN_SLOTS_BASE,
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

/** A player holding `owned`, at the Bag's Logbook or at the workbench of `station`. */
function logbookSource(owned: Record<string, number>, station?: string): LogbookSource {
  const seen: Record<string, boolean> = {};
  for (const key of Object.keys(owned)) seen[key] = true;
  return {
    crafting: registry.crafting,
    ...(station === undefined ? {} : { station }),
    seen,
    owned: (ingredient) => owned[ingredient] ?? 0,
    room: () => MAX_CRAFT_COUNT,
  };
}

const BENCH = 'station:workbench';

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
    expect(slotNumbers(bag.element).sort((a, b) => a - b)).toEqual([
      ...Array.from({ length: BASE_INVENTORY_SLOTS }, (_, i) => i),
      ...WEAR_SLOTS.map((_, i) => OPEN_SLOTS_BASE + i),
    ]);
    expect(byAttr(bag.element, 'data-wear').map((e) => e.getAttribute('data-wear'))).toEqual(
      WEAR_SLOTS,
    );
    // Each box of the silhouette is the slot of its worn item, from 64 on.
    const boxes = byAttr(bag.element, 'data-wear').map((box) => slotNumbers(box as never));
    expect(boxes).toEqual(WEAR_SLOTS.map((_, i) => [OPEN_SLOTS_BASE + i]));
  });

  it('sends a slot click per press: left or right, with Shift, and outside the panel', () => {
    const { screen, sent } = deps();
    const bag = new BagScreen(screen, new LogbookPanel(screen.art, screen.actions, LIMITS));
    bag.open();
    const slot = (n: number) => byAttr(bag.element, 'data-slot', String(n))[0]!;
    const head = OPEN_SLOTS_BASE + WEAR_SLOTS.indexOf('head');
    const press = (target: FakeElement, button: number, shiftKey = false) =>
      fake(bag.element).dispatch('pointerdown', {
        target,
        button,
        shiftKey,
        preventDefault: () => {},
      });
    press(slot(3), 0);
    press(slot(head), 2);
    press(slot(9), 0, true);
    // A press on the panel (its title) is no click; one beside it (the backdrop) is slot −1.
    press(fake(bag.element).querySelector('.bag-header')!, 0);
    press(fake(bag.element), 2);
    // The middle button clicks nothing.
    press(slot(3), 1);
    expect(sent).toEqual([
      { type: 'slot.click', slot: 3, button: 0, shift: false },
      { type: 'slot.click', slot: head, button: 1, shift: false },
      { type: 'slot.click', slot: 9, button: 0, shift: true },
      { type: 'slot.click', slot: -1, button: 1, shift: false },
    ]);
    // A hotbar key over a slot: that slot and the hotbar slot.
    fake(bag.element).dispatch('pointerover', { target: slot(head) });
    bag.hotkey(2);
    expect(sent.at(-1)).toEqual({ type: 'slot.hotkey', slot: head, hotbar: 2 });
  });

  it('shows the Inventory or the Logbook page from its tab bar, the one chosen last first', () => {
    const { screen } = deps();
    const logbook = new LogbookPanel(screen.art, screen.actions, LIMITS);
    const bag = new BagScreen(screen, logbook);
    const wear = fake(bag.element).querySelector('.wear')!;
    const tab = (page: string) => byAttr(bag.element, 'data-page', page)[0]!;
    expect(byAttr(bag.element, 'data-page').map((e) => e.getAttribute('data-page'))).toEqual([
      'inventory',
      'logbook',
    ]);
    expect([bag.shown(), wear.hidden, fake(logbook.element).hidden]).toEqual([
      'inventory',
      false,
      true,
    ]);
    tab('logbook').dispatch('click');
    expect([bag.shown(), wear.hidden, fake(logbook.element).hidden]).toEqual([
      'logbook',
      true,
      false,
    ]);
    expect(tab('logbook').className).toBe('bag-tab active');
    expect(tab('inventory').getAttribute('aria-pressed')).toBe('false');
    // Both pages sit beside the same inventory slots; the page stays chosen across openings.
    expect(slotNumbers(bag.element)).toHaveLength(BASE_INVENTORY_SLOTS + WEAR_SLOTS.length);
    bag.open();
    bag.close();
    bag.open();
    expect(bag.shown()).toBe('logbook');
  });

  it('draws the cursor stack under the pointer while it holds one', () => {
    const { screen } = deps();
    const bag = new BagScreen(screen, new LogbookPanel(screen.art, screen.actions, LIMITS));
    bag.open();
    const cursor = fake(bag.element).querySelector('.slot-cursor')!;
    // Not a slot: a press on it (it ignores the pointer anyway) clicks nothing.
    expect(cursor.getAttribute('data-slot')).toBeNull();
    expect(cursor.hidden).toBe(true);
    const slots: Inventory = new Array(OPEN_SLOTS_BASE + WEAR_SLOTS.length).fill(null);
    const gear = { armor: 0, warmth: 0, cooling: 0, airFilter: 1, waterproof: false };
    const state = { source: logbookSource({}), queue: [] };
    fake(bag.element).dispatch('pointermove', { clientX: 120, clientY: 80 });
    bag.update(slots, { item: 'item:flint', count: 3 }, state, gear);
    expect(cursor.hidden).toBe(false);
    expect(cursor.textContent).toContain('3');
    expect(cursor.style.transform).toBe('translate(120px, 80px)');
    fake(bag.element).dispatch('pointermove', { clientX: 200, clientY: 90 });
    expect(cursor.style.transform).toBe('translate(200px, 90px)');
    bag.update(slots, null, state, gear);
    expect(cursor.hidden).toBe(true);
  });

  it('shows what the worn items protect from', () => {
    const { screen } = deps();
    const bag = new BagScreen(screen, new LogbookPanel(screen.art, screen.actions, LIMITS));
    const slots: Inventory = new Array(OPEN_SLOTS_BASE + WEAR_SLOTS.length).fill(null);
    slots[9] = { item: 'item:fur_hood', count: 1 };
    const gear = { armor: 3, warmth: 16, cooling: 0, airFilter: 1, waterproof: false };
    bag.update(slots, null, { source: logbookSource({}), queue: [] }, gear);
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

  it('counts the recipes made at the workbench, and shows where an unseen ingredient is found', () => {
    const { logbook, root } = panel();
    logbook.update({ source: logbookSource({ 'item:planks': 8 }), queue: [] });
    byAttr(root, 'data-tab', 'building')[0]!.dispatch('click');
    expect(byAttr(root, 'data-recipe', 'recipe:chest')).toEqual([]);
    expect(fake(root).querySelector('.logbook-footer')?.textContent).toBe(
      '2 more at the Workbench',
    );
    byAttr(root, 'data-tab', 'survival')[0]!.dispatch('click');
    byAttr(root, 'data-recipe', 'recipe:unfired_flask')[0]!.dispatch('click');
    expect(fake(root).querySelector('.logbook-hint')?.textContent).toBe(
      'Dug from clay banks along the shores',
    );
  });

  it('searches outputs and ingredients, and « Can craft now » keeps what the inventory pays for', () => {
    const { logbook, root } = panel();
    const search = fake(root).findAll((e) => e.getAttribute('data-action') === 'search')[0]!;
    const type = (text: string) => {
      (search as unknown as { value: string }).value = text;
      search.dispatch('input');
    };
    const rows = () => byAttr(root, 'data-recipe').map((e) => e.getAttribute('data-recipe'));
    logbook.update({ source: logbookSource(tools), queue: [] });
    byAttr(root, 'data-tab', 'tools')[0]!.dispatch('click');
    type('HATCHET');
    expect(rows()).toEqual(['recipe:flint_hatchet']);
    // By an ingredient's name; the tab's badge counts what the search keeps.
    type('cord');
    expect(rows()).toEqual(['recipe:flint_hatchet', 'recipe:flint_pickaxe', 'recipe:flint_spear']);
    const badge = byAttr(root, 'data-tab', 'tools')[0]!.querySelector('.logbook-count');
    expect(badge?.textContent).toBe('2');
    type('nothing like it');
    expect(rows()).toEqual([]);
    expect(fake(root).querySelector('.logbook-empty')?.textContent).toBe('No recipe matches.');
    type('');
    const filter = fake(root).findAction('craftable-only')!;
    filter.dispatch('click');
    expect(filter.getAttribute('aria-pressed')).toBe('true');
    expect(rows()).toEqual(['recipe:flint_knife', 'recipe:flint_hatchet', 'recipe:flint_pickaxe']);
    filter.dispatch('click');
    expect(rows().length).toBeGreaterThan(3);
  });

  it('lists undiscovered recipes greyed at the bottom, their unseen ingredients as « ? »', () => {
    const { logbook, sent, root } = panel();
    logbook.update({ source: logbookSource({}), queue: [] });
    byAttr(root, 'data-tab', 'survival')[0]!.dispatch('click');
    const rows = byAttr(root, 'data-recipe');
    const bandage = byAttr(root, 'data-recipe', 'recipe:bandage')[0]!;
    expect(bandage.className).toBe('logbook-row undiscovered');
    expect(rows.at(-1)).toBe(bandage);
    expect(bandage.querySelector('.logbook-name')?.textContent).toBe('Bandage');
    const unknown = bandage.findAll((e) => e.className === 'item-unknown');
    expect(unknown.map((e) => e.textContent)).toEqual(['?', '?']);
    bandage.dispatch('click');
    const detail = fake(root).querySelector('.logbook-detail')!;
    expect(detail.querySelector('.logbook-undiscovered')).not.toBeNull();
    // Each unseen ingredient: « ? », and where it is found in its name's place.
    const icons = detail.findAll((e) => e.className === 'item-unknown');
    expect(icons.map((e) => e.textContent)).toEqual(['?', '?']);
    const names = detail.findAll((e) => e.className === 'logbook-ingredient logbook-hint');
    expect(names.map((e) => e.textContent)).toEqual([
      'Pulled from tall grass',
      'Oozes from conifer needles and palmthorns',
    ]);
    for (const batch of ['1', '5', 'max'])
      expect((fake(root).findAction(`craft-${batch}`) as { disabled?: boolean }).disabled).toBe(
        true,
      );
    expect(sent).toEqual([]);
    // « Can craft now » hides it.
    fake(root).findAction('craftable-only')!.dispatch('click');
    expect(byAttr(root, 'data-recipe', 'recipe:bandage')).toEqual([]);
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
    // A workbench's Logbook shows the bench's queue: its entries cancel there.
    logbook.update({ source: logbookSource({}, BENCH), queue });
    byAttr(root, 'data-queue', '0')[0]!.dispatch('click');
    expect(sent.at(-1)).toEqual({ type: 'craft.cancel', index: 0, workbench: true });
  });

  it('has a string for every tab, recipe and ingredient it can show', () => {
    const { logbook, root } = panel();
    const everything: Record<string, number> = {};
    for (const item of registry.items) {
      everything[item.key] = 1;
      for (const tag of item.tags ?? []) everything[tag] = 1;
    }
    let shown = 0;
    // The Bag's Logbook, then the workbench's.
    for (const station of [undefined, BENCH]) {
      logbook.update({ source: logbookSource(everything, station), queue: [] });
      for (const category of RECIPE_CATEGORIES) {
        byAttr(root, 'data-tab', category)[0]!.dispatch('click');
        for (const row of byAttr(root, 'data-recipe')) {
          row.dispatch('click');
          shown++;
        }
      }
    }
    expect(shown).toBe(registry.crafting.recipes.length);
    expect(i18nMissing()).toEqual([]);
  });
});

describe('WorkbenchScreen', () => {
  it('numbers its outputs from 64 beside its Logbook, which lists the bench recipes', () => {
    const { screen } = deps();
    const bench = new WorkbenchScreen(screen, new LogbookPanel(screen.art, screen.actions, LIMITS));
    const def = registry.crafting.station(BENCH)!;
    bench.open(def, 'Workbench');
    const title = fake(bench.element).findAll((e) => e.tagName === 'H2')[0];
    expect(title?.textContent).toBe('Workbench');
    const outputs = fake(bench.element).querySelector('.workbench-outputs')!;
    const base = OPEN_SLOTS_BASE;
    expect(slotNumbers(outputs as unknown as HTMLElement)).toEqual([
      base,
      base + 1,
      base + 2,
      base + 3,
    ]);
    expect(slotNumbers(bench.element)).toHaveLength(BASE_INVENTORY_SLOTS + def.outputSlots);
    const slots: Inventory = new Array(base + def.outputSlots).fill(null);
    slots[base + 1] = { item: 'item:chest', count: 2 };
    bench.update(slots, null, {
      source: logbookSource({ 'item:planks': 8, 'item:cord': 1 }, BENCH),
      queue: [],
    });
    byAttr(bench.element, 'data-tab', 'building')[0]!.dispatch('click');
    const rows = byAttr(bench.element, 'data-recipe').map((e) => e.getAttribute('data-recipe'));
    expect(rows[0]).toBe('recipe:chest');
    expect(rows).not.toContain('recipe:workbench');
    expect(byAttr(bench.element, 'data-slot', String(base + 1))[0]!.textContent).toContain('2');
    // Opened again, its output views are made again (no duplicates).
    bench.close();
    bench.open(def, 'Workbench');
    expect(slotNumbers(bench.element)).toHaveLength(BASE_INVENTORY_SLOTS + def.outputSlots);
  });
});

describe('ContainerScreen', () => {
  it('numbers the chest slots from 64; Take all and Store all Shift+click each stack', () => {
    const { screen, sent } = deps();
    const chest = new ContainerScreen(screen);
    chest.open('Chest', 18);
    expect(Math.max(...slotNumbers(chest.element))).toBe(OPEN_SLOTS_BASE + 17);
    const slots: Inventory = new Array(OPEN_SLOTS_BASE + 18).fill(null);
    slots[0] = { item: 'item:dirt', count: 3 };
    slots[9] = { item: 'item:dirt', count: 4 };
    slots[OPEN_SLOTS_BASE + 2] = { item: 'item:flint', count: 1 };
    chest.update(slots, null);
    byAttr(chest.element, 'data-action', 'take-all')[0]!.dispatch('click');
    byAttr(chest.element, 'data-action', 'store-all')[0]!.dispatch('click');
    expect(sent).toEqual([
      { type: 'slot.click', slot: OPEN_SLOTS_BASE + 2, button: 0, shift: true },
      { type: 'slot.click', slot: 9, button: 0, shift: true },
    ]);
    // A second opening makes the chest's views again (another size, no duplicates).
    chest.close();
    chest.open('Chest', 6);
    expect(slotNumbers(chest.element)).toHaveLength(BASE_INVENTORY_SLOTS + 6);
  });
});

describe('StationScreen', () => {
  it('lays out inputs, fuel and output from the station, lists its processes and lights the flame', () => {
    const { screen } = deps();
    const station = new StationScreen(screen);
    const kiln = registry.crafting.station('station:kiln')!;
    station.open(kiln, 'Clay Kiln');
    const base = OPEN_SLOTS_BASE;
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
    const burning = {
      lit: true,
      flame: 0.5,
      progress: 0.25,
      process: 'process:copper_ingot',
      keepLit: false,
    };
    station.update(slots, null, burning);
    expect(flame().className).toBe('flame lit');
    const active = fake(station.element).findAll((e) => e.className === 'station-process active');
    expect(active).toHaveLength(1);
    // A banked fire (idle, fuel time left) is dim: its size stays, it is not lit.
    station.update(slots, null, {
      lit: false,
      flame: 0.5,
      progress: 0,
      process: '',
      keepLit: false,
    });
    expect(flame().className).toBe('flame');
    expect(flame().style.getPropertyValue('--flame')).toBe('0.5');
    station.update(slots, null, { lit: false, flame: 0, progress: 0, process: '', keepLit: false });
    expect(flame().className).toBe('flame');
    // A kiln's fire burns only for its processes: no « Keep burning » toggle.
    expect(fake(station.element).findAction('keep-lit')!.hidden).toBe(true);
  });

  it("shows the campfire's « Keep burning » toggle as the simulation keeps it, and flips it", () => {
    const { screen, sent } = deps();
    const station = new StationScreen(screen);
    station.open(registry.crafting.station('station:campfire')!, 'Campfire');
    const toggle = fake(station.element).findAction('keep-lit')!;
    expect(toggle.hidden).toBe(false);
    const slots: Inventory = new Array(OPEN_SLOTS_BASE + 4).fill(null);
    const status = { lit: false, flame: 0, progress: 0, process: '', keepLit: false };
    station.update(slots, null, status);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    const toggles = () => sent.filter((c) => c.type === 'station.keepLit');
    toggle.dispatch('click');
    expect(toggles()).toEqual([{ type: 'station.keepLit' }]);
    // The screen shows what the simulation keeps, not the click.
    expect(toggle.classList.contains('on')).toBe(false);
    station.update(slots, null, { ...status, keepLit: true, lit: true });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.classList.contains('on')).toBe(true);
    // Each click flips it in the simulation, however soon after the last one (no refresh between).
    toggle.dispatch('click');
    toggle.dispatch('click');
    expect(toggles()).toEqual(new Array(3).fill({ type: 'station.keepLit' }));
  });
});
