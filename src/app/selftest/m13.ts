import { DEFAULT_STACK } from '../../content/items.ts';
import { HOTBAR_SLOTS } from '../../core/player.ts';
import { HOTBAR_CODES } from '../../input/bindings.ts';
import { OPEN_SLOTS_BASE } from '../../sim/commands.ts';
import { countItem } from '../../sim/inventory.ts';
import type { App } from '../App.ts';
import { clickOutside, give, withinFrames } from '../automation.ts';
import { BENCH_CASES } from './m13bench.ts';
import { clickAt, closeScreen, openBag, ready } from './screenSteps.ts';
import {
  assert,
  needsArenaPlayer,
  noErrorsCase,
  openFromSouth,
  PLAY_SCENES,
  type SelftestCase,
  slotsAt,
  UI_FRAMES,
  waitForShown,
  waitForSlot,
  workshopBlock,
} from './support.ts';

/**
 * M13 bag, cursor, Logbook and workbench checks in the arena (?worldType=arena&fixedStep=1
 * &selftest=m0,m13; docs « M13 — Sac, curseur, Logbook et établi »), every move made by clicks on
 * the screens as the mouse does (the simulation owns the cursor stack): a left click carries a
 * stack on the cursor, drawn under the mouse, and puts it down, closing puts it back; a right click
 * takes half or puts one; a click outside the panel throws the stack or one item; Shift+click and
 * a number key over a slot move a stack across; stacks hold 64 (a tool 1); then the workbench and
 * its Logbook (m13bench.ts). The materials moved are items no recipe takes (giving them reveals
 * nothing), found through the pack.
 */

/** Where the throws land, away from where the other cases walk. */
const THROW_SPOT = { x: 28, z: 8 };

/** The cursor stack as `count` (0: empty) when it holds `item`, else −1. */
function cursorCount(app: App, item: string): number {
  const cursor = app.session!.player.cursor;
  if (!cursor) return 0;
  return cursor.item === item ? cursor.count : -1;
}

/**
 * An item stacking to DEFAULT_STACK that no recipe or process takes (giving it reveals nothing)
 * and the player holds none of, so a gift of it fills fresh slots.
 */
function freshMaterial(app: App): string {
  const registry = app.registry!;
  const crafting = registry.crafting;
  const inputs = [...crafting.recipes, ...crafting.processes].flatMap((def) => def.inputs);
  const inventory = app.session!.player.inventory;
  const item = registry.items.find(
    ({ key }) =>
      registry.maxStack(key) === DEFAULT_STACK &&
      countItem(inventory, key) === 0 &&
      !inputs.some((input) => crafting.matches(key, input.item)),
  );
  assert(item, 'the pack has no item left that stacks to 64 and no recipe takes');
  return item.key;
}

/** The slots of the inventory holding an item, in slot order. */
function slotsOf(app: App, item: string): number[] {
  const out: number[] = [];
  app.session!.player.inventory.forEach((stack, i) => {
    if (stack?.item === item) out.push(i);
  });
  return out;
}

/** Gives `count` of a fresh material; returns it and the one slot it filled (count ≤ 64). */
function freshStack(app: App, count: number): { item: string; slot: number } {
  const item = freshMaterial(app);
  give(app, item, count);
  const slots = slotsOf(app, item);
  assert(slots.length === 1, `${count} ${item} filled slots ${slots.join(', ')}`);
  return { item, slot: slots[0]! };
}

/** An empty inventory slot other than `besides`. */
function emptySlot(app: App, besides = -1): number {
  const inventory = app.session!.player.inventory;
  const slot = inventory.findIndex((stack, i) => stack === null && i !== besides);
  assert(slot >= 0, 'the inventory is full');
  return slot;
}

/** The view of the cursor stack on a screen. */
function cursorView(screen: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#screen-${screen} .slot-cursor`);
}

/** Item drops of an item lying in the world, their counts summed. */
function thrown(app: App, item: string): number {
  let count = 0;
  for (const entity of app.session!.host.view.entities.values())
    if (entity.kind === 'itemDrop' && entity.item === item) count += entity.count;
  return count;
}

export const M13_SUITE: readonly SelftestCase[] = [
  {
    name: 'a left click carries a stack on the cursor, drawn under the mouse; another puts it down',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsArenaPlayer,
    run: async (app) => {
      const session = await ready(app);
      const inventory = session.player.inventory;
      const { item, slot } = freshStack(app, 10);
      openBag(app, 'inventory');
      try {
        await waitForSlot('bag', slot);
        clickAt(app, slot);
        assert(cursorCount(app, item) === 10, `the cursor holds ${cursorCount(app, item)} ${item}`);
        assert(inventory[slot] === null, `slot ${slot} kept ${inventory[slot]?.count} ${item}`);
        await waitForShown('#screen-bag .slot-cursor:not([hidden])', 'the cursor stack');
        const label = cursorView('bag')?.querySelector('.slot-count')?.textContent;
        assert(label === '10', `the cursor stack reads "${label}", not "10"`);
        const to = emptySlot(app, slot);
        clickAt(app, to);
        assert(inventory[to]?.count === 10 && cursorCount(app, item) === 0, `slot ${to} got none`);
        const hidden = await withinFrames(UI_FRAMES, () => cursorView('bag')?.hidden === true);
        assert(hidden, 'the empty cursor still shows a stack');
        // Closing the Bag with a stack on the cursor puts it back in the inventory.
        clickAt(app, to);
        assert(cursorCount(app, item) === 10, 'the stack did not come onto the cursor again');
      } finally {
        closeScreen(app);
      }
      assert(session.player.cursor === null, 'closing the Bag left the cursor stack');
      assert(
        countItem(inventory, item) === 10,
        `${countItem(inventory, item)} ${item} after closing`,
      );
    },
  },
  {
    name: 'a right click takes half a stack (rounded up) or puts one item; a left click merges',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsArenaPlayer,
    run: async (app) => {
      const session = await ready(app);
      const inventory = session.player.inventory;
      const { item, slot } = freshStack(app, 9);
      openBag(app, 'inventory');
      try {
        await waitForSlot('bag', slot);
        clickAt(app, slot, 1);
        const half = [inventory[slot]?.count, cursorCount(app, item)];
        assert(half.join() === '4,5', `a right click left ${half.join(' and ')} (not 4 and 5)`);
        const one = emptySlot(app);
        clickAt(app, one, 1);
        const put = [inventory[one]?.count, cursorCount(app, item)];
        assert(put.join() === '1,4', `a right click put down ${put.join(' and kept ')}`);
        clickAt(app, slot);
        const merged = [inventory[slot]?.count, cursorCount(app, item)];
        assert(merged.join() === '8,0', `a left click merged into ${merged.join(' and kept ')}`);
      } finally {
        closeScreen(app);
      }
      assert(countItem(inventory, item) === 9, `${countItem(inventory, item)} ${item}, not 9`);
    },
  },
  {
    name: 'a click outside the panel throws the cursor stack (left) or one of its items (right)',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsArenaPlayer,
    run: async (app) => {
      const session = await ready(app, THROW_SPOT);
      const inventory = session.player.inventory;
      const { item, slot } = freshStack(app, 6);
      openBag(app, 'inventory');
      try {
        await waitForSlot('bag', slot);
        clickAt(app, slot);
        assert(clickOutside(1), 'no slot screen to click beside');
        session.step(1);
        const one = [cursorCount(app, item), thrown(app, item)];
        assert(one.join() === '5,1', `a right click outside kept ${one.join(', threw ')}`);
        assert(clickOutside(0), 'no slot screen to click beside');
        session.step(1);
        const all = [cursorCount(app, item), thrown(app, item)];
        assert(all.join() === '0,6', `a left click outside kept ${all.join(', threw ')}`);
        // Nothing on the cursor: another click outside throws nothing.
        assert(clickOutside(0), 'no slot screen to click beside');
        session.step(1);
        assert(thrown(app, item) === 6, `${thrown(app, item)} ${item} thrown, not 6`);
      } finally {
        closeScreen(app);
      }
      assert(countItem(inventory, item) === 0, `${countItem(inventory, item)} ${item} left`);
    },
  },
  {
    name: 'Shift+click sends a stack across (hotbar ⇄ bag, inventory ⇄ chest); a number key swaps',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsArenaPlayer,
    run: async (app) => {
      const session = await ready(app);
      const inventory = session.player.inventory;
      const { item, slot } = freshStack(app, 5);
      const inBag = (i: number) => i >= HOTBAR_SLOTS;
      /** The one slot holding the item. */
      const where = () => {
        const slots = slotsOf(app, item);
        assert(slots.length === 1, `${item} is in slots ${slots.join(', ')}`);
        return slots[0]!;
      };
      // The last hotbar slot, which its number key selects.
      const hotbar = HOTBAR_SLOTS - 1;
      openBag(app, 'inventory');
      try {
        await waitForSlot('bag', slot);
        // Across (hotbar → bag, or bag → hotbar) and back.
        clickAt(app, slot, 0, true);
        const across = where();
        assert(inBag(across) !== inBag(slot), `Shift+click moved slot ${slot} to ${across}`);
        clickAt(app, across, 0, true);
        assert(inBag(where()) === inBag(slot), `Shift+click did not send slot ${across} back`);
        // A number key over a bag slot: its stack goes to that hotbar slot.
        if (!inBag(where())) clickAt(app, where(), 0, true);
        const from = where();
        const view = document.querySelector(`#screen-bag [data-slot="${from}"]`);
        assert(view, `bag slot ${from} does not show`);
        view.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
        const code = HOTBAR_CODES[hotbar]!;
        window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
        session.step(1);
        assert(inventory[hotbar]?.item === item, `${code} over slot ${from} did not swap it`);
      } finally {
        closeScreen(app);
      }
      const chest = workshopBlock(app, 'chest', (def) => def.blockEntity === 'container').cell;
      await openFromSouth(app, chest, 'container');
      try {
        const before = countItem(slotsAt(app, chest), item);
        await waitForSlot('container', hotbar);
        clickAt(app, hotbar, 0, true);
        const stored = countItem(slotsAt(app, chest), item) - before;
        assert(stored === 5 && countItem(inventory, item) === 0, `the chest got ${stored} ${item}`);
        const at = slotsAt(app, chest).findIndex((stack) => stack?.item === item);
        await waitForSlot('container', OPEN_SLOTS_BASE + at);
        clickAt(app, OPEN_SLOTS_BASE + at, 0, true);
        assert(countItem(inventory, item) === 5, `${countItem(inventory, item)} ${item} came back`);
      } finally {
        closeScreen(app);
      }
    },
  },
  {
    name: 'a stack holds 64: 70 given fill 64 and 6, a merge stops at 64; a tool stacks to 1',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsArenaPlayer,
    run: async (app) => {
      const session = await ready(app);
      const registry = app.registry!;
      const inventory = session.player.inventory;
      const item = freshMaterial(app);
      give(app, item, DEFAULT_STACK + 6);
      const counts = () => slotsOf(app, item).map((slot) => inventory[slot]!.count);
      assert(counts().join() === `${DEFAULT_STACK},6`, `70 ${item} filled ${counts().join(', ')}`);
      const [full, rest] = slotsOf(app, item) as [number, number];
      openBag(app, 'inventory');
      try {
        await waitForSlot('bag', full);
        clickAt(app, full);
        clickAt(app, rest, 1);
        clickAt(app, rest);
        const merged = [inventory[rest]?.count, cursorCount(app, item)];
        assert(
          merged.join() === `${DEFAULT_STACK},6`,
          `merging 63 onto 7 left ${merged.join(' and kept ')}`,
        );
        clickAt(app, full);
        assert(counts().join() === `6,${DEFAULT_STACK}`, `${item} stacks: ${counts().join(', ')}`);
      } finally {
        closeScreen(app);
      }
      const tool = registry.items.find((def) => def.tool !== undefined);
      assert(tool, 'the pack has no tool');
      give(app, tool.key, 2);
      const tools = slotsOf(app, tool.key).map((slot) => inventory[slot]!.count);
      assert(tools.length >= 2 && tools.every((n) => n === 1), `${tool.key} stacks: ${tools}`);
    },
  },
  ...BENCH_CASES,
  noErrorsCase('no errors and no missing strings after the m13 checks'),
];
