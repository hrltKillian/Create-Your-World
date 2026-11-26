import { t } from '../../i18n/i18n.ts';
import { PHYSICS } from '../../sim/physics.ts';
import type { App } from '../App.ts';
import { openBlock, setBlock, waitForChunks, withinFrames } from '../automation.ts';
import {
  assert,
  eventsDuring,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  standAt,
  stateKey,
  tap,
  UI_FRAMES,
} from './support.ts';

/*
 * M18 controls and interfaces (plan v3 « M18 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): each Bag page opens on its own key; a workbench's Logbook lists
 * the hand recipes too; a search finds a recipe of another station and says where it is made; a
 * hovered recipe shows its item's description; a held jump under a low ceiling waits its
 * cooldown. Recipes and blocks come from the pack's data, never by content key.
 */

const KEYS_SPOT = { x: 30, z: -30 };
const BENCH_SPOT = { x: 34, z: -30 };
const JUMP_SPOT = { x: 38, z: -30 };

/** The screen open now (the Bag's page on show when it is the Bag). */
function shown(app: App): string {
  const ui = app.inventory!;
  const screen = ui.screen();
  return screen === 'bag' ? `bag:${ui.bag.shown()}` : String(screen);
}

const pagesCase: SelftestCase = {
  name: 'E, L and B open the Bag on the Inventory, the Logbook and the Bestiary; a page’s key closes it',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    await playerSession(app);
    await standAt(app, KEYS_SPOT);
    app.inventory!.closeScreen();
    tap('KeyL', 'l');
    assert(shown(app) === 'bag:logbook', `L showed ${shown(app)}`);
    tap('KeyB', 'b');
    assert(shown(app) === 'bag:bestiary', `B showed ${shown(app)}`);
    tap('KeyB', 'b');
    assert(shown(app) === 'null', `B on the Bestiary left ${shown(app)}`);
    tap('KeyE', 'e');
    assert(shown(app) === 'bag:inventory', `E showed ${shown(app)}`);
    tap('KeyE', 'e');
    assert(shown(app) === 'null', `E on the Inventory left ${shown(app)}`);
  },
};

const logbookCase: SelftestCase = {
  name: 'a workbench lists the hand recipes; a search shows where a recipe is made; a hover describes',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const registry = app.registry!;
    await standAt(app, BENCH_SPOT);
    await waitForChunks(app, 1, 15_000);
    const crafting = registry.crafting;
    const benchBlock = registry.blocks.find((b) => b.blockEntity === 'workbench');
    assert(benchBlock, 'the pack has no workbench');
    const hand = crafting.recipes.find((r) => r.station === undefined && r.known === 'start');
    const benchRecipe = crafting.recipes.find((r) => r.station !== undefined);
    assert(hand && benchRecipe, 'the pack lacks a hand or a workbench recipe');
    const cell = { x: BENCH_SPOT.x, y: Math.floor(session.player.body.y), z: BENCH_SPOT.z - 2 };
    setBlock(app, cell.x, cell.y, cell.z, stateKey(app, registry.defaultState(benchBlock.key)));
    openBlock(app, cell.x, cell.y, cell.z);
    assert(app.inventory!.screen() === 'workbench', `the bench showed ${shown(app)}`);
    const row = (key: string) => document.querySelector(`#screen-workbench [data-recipe="${key}"]`);
    const tab = document.querySelector(
      `#screen-workbench [data-tab="${hand.category}"]`,
    ) as HTMLElement | null;
    tab?.click();
    assert(
      await withinFrames(UI_FRAMES, () => row(hand.key) !== null),
      'no hand recipe at the bench',
    );
    tap('KeyE', 'e');
    // The Bag's Logbook: a search for the workbench recipe's output shows it, made elsewhere.
    tap('KeyL', 'l');
    const search = document.querySelector(
      '#screen-bag [data-action="search"]',
    ) as HTMLInputElement | null;
    assert(search, 'the Logbook has no search box');
    const name = registry.item(benchRecipe.output.item)!.nameKey;
    search.value = t(name);
    search.dispatchEvent(new Event('input'));
    const station = () =>
      document.querySelector(`#screen-bag [data-recipe="${benchRecipe.key}"] .logbook-station`);
    assert(await withinFrames(UI_FRAMES, () => station() !== null), 'the search did not say where');
    // A hovered discovered recipe shows its item's description in a bubble.
    search.value = '';
    search.dispatchEvent(new Event('input'));
    const described = crafting.recipes.find(
      (r) => r.station === undefined && r.known === 'start' && registry.item(r.output.item)?.tool,
    );
    assert(described, 'no tool known from the start');
    const toolTab = document.querySelector(
      `#screen-bag [data-tab="${described.category}"]`,
    ) as HTMLElement | null;
    toolTab?.click();
    const hovered = () => document.querySelector(`#screen-bag [data-recipe="${described.key}"]`);
    assert(
      await withinFrames(UI_FRAMES, () => hovered() !== null),
      'the tool recipe does not show',
    );
    hovered()!.dispatchEvent(new PointerEvent('pointerenter', { clientX: 200, clientY: 200 }));
    const bubble = document.querySelector<HTMLElement>('#screen-bag .logbook .tooltip-anchor');
    assert(bubble && !bubble.hidden && bubble.textContent, 'the hovered recipe shows no bubble');
    hovered()!.dispatchEvent(new PointerEvent('pointerleave'));
    tap('KeyL', 'l');
  },
};

const jumpCase: SelftestCase = {
  name: 'a jump held under a low ceiling waits its cooldown between two jumps',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    await standAt(app, JUMP_SPOT);
    await waitForChunks(app, 1, 15_000);
    const feet = Math.floor(session.player.body.y);
    const stone = stateKey(app, app.registry!.defaultState(app.registry!.pack.worldgen!.stone));
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        setBlock(app, JUMP_SPOT.x + dx, feet + 2, JUMP_SPOT.z + dz, stone);
    const input = app.input!;
    const ticks = 60;
    input.force('jump', 1e6);
    let jumps = 0;
    try {
      const events = eventsDuring(app, () => session.step(ticks));
      jumps = events.filter((e) => e.type === 'playerJumped').length;
    } finally {
      input.force('jump', 0);
      session.step(1);
    }
    assert(jumps >= 2, `only ${jumps} jumps in ${ticks} ticks`);
    assert(
      jumps <= Math.ceil(ticks / PHYSICS.jumpCooldownTicks),
      `${jumps} jumps in ${ticks} ticks: no cooldown`,
    );
  },
};

export const M18_SUITE: readonly SelftestCase[] = [
  pagesCase,
  logbookCase,
  jumpCase,
  noErrorsCase('no errors after the m18 checks'),
];
