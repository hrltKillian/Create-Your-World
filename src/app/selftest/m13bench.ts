import type { RecipeDef } from '../../content/schema.ts';
import { t } from '../../i18n/i18n.ts';
import { ticksOf } from '../../sim/clock.ts';
import { OPEN_SLOTS_BASE } from '../../sim/commands.ts';
import { entryCrafts } from '../../sim/craftQueue.ts';
import { countItem } from '../../sim/inventory.ts';
import { ingredientName } from '../../ui/itemSlot.ts';
import { searchKey } from '../../ui/logbook.ts';
import type { App } from '../App.ts';
import { click, give, withinFrames } from '../automation.ts';
import { clickAt, closeScreen, openBag, ready } from './screenSteps.ts';
import {
  assert,
  type Cell,
  needsArenaPlayer,
  openFromSouth,
  PLAY_SCENES,
  type SelftestCase,
  UI_FRAMES,
  waitForShown,
  waitForSlot,
  workshopBlock,
} from './support.ts';

/**
 * The M13 workbench cases (m13.ts runs them, in the arena): secondary on the workshop's workbench
 * opens its screen, where five ×1 make one queue entry of 5 that the bench crafts into its
 * outputs; its Logbook searches names without case or accents, « Can craft now » keeps what the
 * inventory pays for and the undiscovered recipes are greyed at the bottom; the Bag's Logbook lists
 * the hand recipes and how many more the workbench makes.
 */

/** Crafts queued at the workbench, one ×1 click each. */
const BENCH_CRAFTS = 5;
/** Ticks the bench gets past its crafts' own time. */
const CRAFT_SLACK = 30;

/** The workshop's workbench: its cell. */
function workbench(app: App): Cell {
  return workshopBlock(app, 'workbench', (def) => def.blockEntity === 'workbench').cell;
}

/**
 * The first recipe of the workbench whose queue entry holds BENCH_CRAFTS crafts, of plain items
 * (the debug gift gives items, not tags).
 */
function benchRecipe(app: App): RecipeDef {
  const registry = app.registry!;
  const station = workshopBlock(app, 'workbench', (def) => def.blockEntity === 'workbench').def
    .station;
  const recipe = registry.crafting.recipes.find(
    (r) =>
      r.station === station &&
      entryCrafts(registry, r) >= BENCH_CRAFTS &&
      r.inputs.every((input) => registry.item(input.item) !== undefined),
  );
  assert(recipe, `no recipe of ${station} holds ${BENCH_CRAFTS} crafts in one entry`);
  return recipe;
}

/** Gives the ingredients of `crafts` crafts of a recipe. */
function giveInputs(app: App, recipe: RecipeDef, crafts: number): void {
  for (const input of recipe.inputs) give(app, input.item, input.count * crafts);
}

/** The recipe keys of the rows a screen's Logbook lists, in order. */
function logbookRows(screen: string): string[] {
  return [...document.querySelectorAll(`#screen-${screen} .logbook-row`)].map(
    (row) => row.getAttribute('data-recipe') ?? '',
  );
}

/** Types into a screen's Logbook search box as the keyboard does (its `input` event). */
function search(screen: string, text: string): void {
  const box = document.querySelector<HTMLInputElement>(`#screen-${screen} [data-action="search"]`);
  assert(box, `the ${screen} screen's Logbook has no search box`);
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
}

/** A search text with an accent and other case than a name (« planks » → « PLÁNKS »). */
function accented(name: string): string {
  return name.replace(/[aeo]/i, (vowel) => `${vowel}́`).toUpperCase();
}

export const BENCH_CASES: readonly SelftestCase[] = [
  {
    name: 'secondary on the workbench opens its screen; five ×1 make one entry of 5, crafted there',
    scenes: PLAY_SCENES,
    timeoutMs: 40_000,
    skip: needsArenaPlayer,
    run: async (app) => {
      const session = await ready(app);
      const registry = app.registry!;
      const inventory = session.player.inventory;
      const bench = workbench(app);
      const recipe = benchRecipe(app);
      const output = recipe.output.item;
      giveInputs(app, recipe, BENCH_CRAFTS);
      const before = countItem(inventory, output);
      await openFromSouth(app, bench, 'workbench');
      try {
        const entity = () => session.host.view.blockEntity(bench.x, bench.y, bench.z);
        const queue = () => {
          const at = entity();
          return at?.kind === 'workbench' ? at.craft : [];
        };
        assert(queue().length === 0, `the workbench queue already holds ${queue().length}`);
        const tab = `#screen-workbench [data-tab="${recipe.category}"]`;
        await waitForShown(tab, `the workbench Logbook's "${recipe.category}" tab`);
        assert(click(tab), `no "${recipe.category}" tab`);
        // Its Logbook lists the bench's recipes and the hand ones (plan v3 « M18 »).
        const station = recipe.station;
        for (const key of logbookRows('workbench')) {
          const listed = registry.crafting.recipe(key)?.station;
          assert(
            listed === station || listed === undefined,
            `the workbench Logbook lists ${key} (made at ${listed})`,
          );
        }
        assert(click(`#screen-workbench [data-recipe="${recipe.key}"]`), `no ${recipe.key} row`);
        for (let i = 0; i < BENCH_CRAFTS; i++) {
          assert(click('#screen-workbench [data-action="craft-1"]'), `×1 is off at click ${i + 1}`);
          session.step(1);
        }
        const entries = queue().map((entry) => `${entry.recipe}×${entry.count}`);
        assert(
          entries.join() === `${recipe.key}×${BENCH_CRAFTS}`,
          `five ×1 queued ${entries.join(', ') || 'nothing'}`,
        );
        await waitForShown('#screen-workbench [data-queue="0"]', 'the queue entry');
        const shown = document.querySelector('#screen-workbench [data-queue="0"] .slot-count');
        assert(
          shown?.textContent === String(BENCH_CRAFTS),
          `the entry reads ${shown?.textContent}`,
        );
        assert(!document.querySelector('#screen-workbench [data-queue="1"]'), 'a second entry');
        session.step(BENCH_CRAFTS * ticksOf(recipe.seconds) + CRAFT_SLACK);
        assert(queue().length === 0, `${queue().length} entries left after the crafts`);
        const made = BENCH_CRAFTS * recipe.output.count;
        const outputs = entity()?.slots ?? [];
        assert(
          countItem(outputs, output) === made,
          `the outputs hold ${countItem(outputs, output)}`,
        );
        // An output only gives: Shift+click sends it to the inventory.
        const at = outputs.findIndex((stack) => stack?.item === output);
        await waitForSlot('workbench', OPEN_SLOTS_BASE + at);
        clickAt(app, OPEN_SLOTS_BASE + at, 0, true);
      } finally {
        closeScreen(app);
      }
      const got = countItem(inventory, output) - before;
      assert(got === BENCH_CRAFTS * recipe.output.count, `${got} ${output} reached the inventory`);
    },
  },
  {
    name: 'the Logbook search ignores case and accents, « Can craft now » filters, undiscovered rows grey',
    scenes: PLAY_SCENES,
    timeoutMs: 30_000,
    skip: needsArenaPlayer,
    run: async (app) => {
      const session = await ready(app);
      const registry = app.registry!;
      const crafting = registry.crafting;
      const name = (key: string) => ingredientName(registry, key);
      const recipe = benchRecipe(app);
      giveInputs(app, recipe, 1);
      const station = recipe.station!;
      const hidden = crafting.recipes.find(
        (r) => r.station === station && !crafting.revealed(r, session.player.seen),
      );
      assert(hidden, `every recipe of ${station} is revealed: none to see greyed`);
      await openFromSouth(app, workbench(app), 'workbench');
      try {
        const tab = (category: string) => {
          const selector = `#screen-workbench [data-tab="${category}"]`;
          assert(click(selector), `no "${category}" tab`);
        };
        await waitForShown('#screen-workbench [data-tab]', "the workbench Logbook's tabs");
        tab(recipe.category);
        // By an ingredient's name, in other case and with an accent.
        const query = accented(name(recipe.inputs[0]!.item));
        search('workbench', query);
        const found = logbookRows('workbench');
        assert(found.includes(recipe.key), `searching "${query}" did not find ${recipe.key}`);
        for (const key of found) {
          const def = crafting.recipe(key)!;
          const names = [def.output.item, ...def.inputs.map((input) => input.item)].map(name);
          assert(
            names.some((n) => searchKey(n).includes(searchKey(query))),
            `searching "${query}" lists ${key}`,
          );
        }
        search('workbench', '');
        assert(click('#screen-workbench [data-action="craftable-only"]'), 'no « Can craft now »');
        const craftable = [...document.querySelectorAll('#screen-workbench .logbook-row')];
        assert(
          craftable.every((row) => row.classList.contains('craftable')),
          `« Can craft now » lists ${logbookRows('workbench').join(', ')}`,
        );
        assert(logbookRows('workbench').includes(recipe.key), `${recipe.key} is not listed`);
        click('#screen-workbench [data-action="craftable-only"]');
        // An undiscovered recipe: greyed at the bottom of its tab, its ingredients « ? ».
        tab(hidden.category);
        const rows = [...document.querySelectorAll('#screen-workbench .logbook-row')];
        const row = rows.find((r) => r.getAttribute('data-recipe') === hidden.key);
        assert(row, `${hidden.key} is not listed`);
        assert(row.classList.contains('undiscovered'), `${hidden.key} is not greyed`);
        const first = rows.findIndex((r) => r.classList.contains('undiscovered'));
        assert(
          rows.slice(first).every((r) => r.classList.contains('undiscovered')),
          'a revealed recipe is listed below an undiscovered one',
        );
        const unknown = row.querySelectorAll('.item-unknown').length;
        assert(unknown === hidden.inputs.length, `${unknown} « ? » for ${hidden.inputs.length}`);
        assert(click(`#screen-workbench [data-recipe="${hidden.key}"]`), `no ${hidden.key} row`);
        assert(
          document.querySelector('#screen-workbench .logbook-undiscovered'),
          'its details do not say it is undiscovered',
        );
        assert(
          !click('#screen-workbench [data-action="craft-1"]'),
          'an undiscovered recipe crafts',
        );
        // It follows the search; the filter hides it.
        search('workbench', name(hidden.output.item));
        assert(logbookRows('workbench').includes(hidden.key), 'the search lost it');
        click('#screen-workbench [data-action="craftable-only"]');
        assert(!logbookRows('workbench').includes(hidden.key), '« Can craft now » kept it');
        click('#screen-workbench [data-action="craftable-only"]');
        search('workbench', '');
      } finally {
        closeScreen(app);
      }
      // The Bag's Logbook lists the hand recipes and says how many more the workbench makes.
      openBag(app, 'logbook');
      try {
        const seen = session.player.seen;
        const more = crafting.recipes.filter(
          (r) => r.station === station && crafting.revealed(r, seen),
        ).length;
        const stationName = t(crafting.station(station)!.nameKey);
        const expected = t('logbook.atStation', { n: more, station: stationName });
        // The bridge refreshes the Bag on its next frame.
        const footer = () => document.querySelector('#screen-bag .logbook-footer')?.textContent;
        const counted = await withinFrames(UI_FRAMES, () => footer() === expected);
        assert(counted, `the Bag's Logbook ends with "${footer()}", not "${expected}"`);
        for (const key of logbookRows('bag'))
          assert(crafting.recipe(key)?.station === undefined, `the Bag's Logbook lists ${key}`);
      } finally {
        closeScreen(app);
      }
    },
  },
];
