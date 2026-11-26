import { HOTBAR_SLOTS } from '../../core/player.ts';
import type { ItemStack } from '../../sim/inventory.ts';
import { click, waitForChunks, withinFrames } from '../automation.ts';
import {
  assert,
  needsArenaPlayer,
  noErrorsCase,
  openFromSouth,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  slotsAt,
  tap,
  UI_FRAMES,
  workshopBlock,
} from './support.ts';

/*
 * M32 inventory comfort (plan v3 « M32 »), in the arena with fixed steps
 * (?worldType=arena&fixedStep=1): the Bag's « Sort » merges and orders the bag; « Stack into
 * chests nearby » moves the bag's items into the workshop's chest that holds them; the workshop's
 * workbench crafts with ingredients from that chest. Items come from the pack's recipes.
 */

const sortCase: SelftestCase = {
  name: 'the Bag sorts the bag and stacks its items into the chest nearby that holds them',
  scenes: PLAY_SCENES,
  skip: needsArenaPlayer,
  timeoutMs: 60_000,
  run: async (app) => {
    const session = await playerSession(app);
    const registry = app.registry!;
    const chest = workshopBlock(app, 'chest', (d) => d.blockEntity === 'container');
    await openFromSouth(app, chest.cell, 'container');
    app.inventory!.closeScreen();
    await waitForChunks(app, 1, 15_000);
    // An item of the pack no recipe needs here: the bench's first ingredient will do.
    const item = registry.pack.items![0]!.key;
    const inventory = session.player.inventory;
    const bag = HOTBAR_SLOTS;
    for (let i = bag; i < inventory.length; i++) inventory[i] = null;
    inventory[bag + 5] = { item, count: 3 };
    inventory[bag + 2] = { item, count: 4 };
    tap('KeyE', 'e');
    assert(click('#screen-bag [data-action="bag-sort"]'), 'no « Sort » button');
    session.step(1);
    const first = inventory[bag] as ItemStack | null;
    assert(
      first?.item === item && first.count === 7,
      `the bag starts with ${JSON.stringify(first)}`,
    );
    assert(inventory[bag + 5] === null, 'the bag was not merged');
    // The chest holds one of them: the bag's go there.
    const slots = slotsAt(app, chest.cell);
    for (let i = 0; i < slots.length; i++) slots[i] = null;
    slots[0] = { item, count: 1 };
    assert(click('#screen-bag [data-action="stack-nearby"]'), 'no « Stack into chests nearby »');
    session.step(1);
    assert(slots[0]?.count === 8, `the chest holds ${JSON.stringify(slots[0])}`);
    assert(inventory[bag] === null, 'the bag kept its items');
    slots[0] = null;
    tap('KeyE', 'e');
  },
};

const benchCase: SelftestCase = {
  name: 'the workbench crafts with the ingredients of the chest beside it',
  scenes: PLAY_SCENES,
  skip: needsArenaPlayer,
  timeoutMs: 60_000,
  run: async (app) => {
    const session = await playerSession(app);
    const registry = app.registry!;
    const crafting = registry.crafting;
    const chest = workshopBlock(app, 'chest', (d) => d.blockEntity === 'container');
    const bench = workshopBlock(app, 'workbench', (d) => d.blockEntity === 'workbench');
    // A bench recipe of plain items (no tag), revealed: its ingredients only in the chest.
    const recipe = crafting.recipes.find(
      (r) =>
        r.station === bench.def.station &&
        r.known !== 'blueprint' &&
        (r.level ?? 1) <= 1 &&
        r.inputs.every((input) => !input.item.startsWith('tag:')),
    );
    assert(recipe, 'no plain recipe at the workbench');
    const player = session.player;
    for (const input of recipe.inputs) player.seen[input.item] = true;
    for (let i = 0; i < player.inventory.length; i++) {
      const stack = player.inventory[i];
      if (stack && recipe.inputs.some((input) => input.item === stack.item))
        player.inventory[i] = null;
    }
    await openFromSouth(app, chest.cell, 'container');
    app.inventory!.closeScreen();
    const slots = slotsAt(app, chest.cell);
    for (let i = 0; i < slots.length; i++) slots[i] = null;
    recipe.inputs.forEach((input, i) => {
      slots[i] = { item: input.item, count: input.count };
    });
    await openFromSouth(app, bench.cell, 'workbench');
    const row = `#screen-workbench [data-recipe="${recipe.key}"]`;
    // Its category's tab, once the screen is drawn.
    const craftable = () => {
      click(`#screen-workbench [data-tab="${recipe.category}"]`);
      return document.querySelector(row)?.classList.contains('craftable') ?? false;
    };
    assert(await withinFrames(UI_FRAMES, craftable), 'the Logbook does not count the chest');
    session.host.send({ type: 'craft.enqueue', recipe: recipe.key, count: 1 });
    session.step(1);
    const queue =
      slotsAt(app, bench.cell) &&
      session.host.view.blockEntity(bench.cell.x, bench.cell.y, bench.cell.z);
    assert(queue?.kind === 'workbench' && queue.craft.length === 1, 'the craft was not queued');
    assert(
      slots.every((slot) => slot === null),
      'the chest kept the ingredients',
    );
    app.inventory!.closeScreen();
  },
};

export const M32_SUITE: readonly SelftestCase[] = [
  sortCase,
  benchCase,
  noErrorsCase('no errors after the m32 checks'),
];
