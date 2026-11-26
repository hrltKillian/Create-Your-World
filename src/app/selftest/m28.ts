import { t } from '../../i18n/i18n.ts';
import { HINT_SECONDS } from '../../ui/hud/hudHint.ts';
import { ROW_ICONS } from '../../ui/hud/vitals.ts';
import { frameOrFail, give, press, withinFrames } from '../automation.ts';
import {
  assert,
  needsFlatPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  type SelftestCase,
  standAt,
  tap,
  UI_FRAMES,
} from './support.ts';

/*
 * M28 interfaces (plan v3 « M28 », the third play test), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): quest messages on their own line, which a hint does not take; a
 * hovered stack's description in a bubble, the Bag the same size on every page; a journal in hand
 * read on secondary in its book, closed by the Bag's key; the gauges as rows of symbols over the
 * hotbar. Items come from the pack's data (the first journal).
 */

const SPOT = { x: 60, z: -60 };

const questNewsCase: SelftestCase = {
  name: 'a quest message has its own line, which a hint does not replace',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const quest = app.registry!.pack.quests?.find((q) => q.requires);
    assert(quest, 'the pack has no quest');
    // The HUD's path alone: the event as the simulation sends it.
    for (const listener of session.listeners)
      listener({
        type: 'questDone',
        playerId: session.player.playerId,
        quest: quest.key,
        already: true,
      });
    const news = () => document.getElementById('hud-quest-news');
    const text = t('hud.questAlready', { name: t(quest.textKey) });
    assert(
      await withinFrames(UI_FRAMES, () => news()?.hidden === false && news()?.textContent === text),
      `the quest line says "${news()?.textContent}"`,
    );
    app.inventory!.hint.show('selftest hint');
    assert(news()?.textContent === text && !news()?.hidden, 'a hint took the quest line');
    assert(HINT_SECONDS < 6, 'quest messages are not longer than hints');
  },
};

const bubbleCase: SelftestCase = {
  name: 'a hovered stack shows its description in a bubble; the Bag keeps its size on every page',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    await standAt(app, SPOT);
    const tool = app.registry!.pack.items?.find((item) => item.tool);
    assert(tool, 'the pack has no tool');
    give(app, tool.key, 1);
    app.inventory!.closeScreen();
    tap('KeyE', 'e');
    assert(app.inventory!.screen() === 'bag', 'E did not open the Bag');
    const slot = session.player.inventory.findIndex((stack) => stack?.item === tool.key);
    const view = () =>
      document.querySelector<HTMLElement>(`#screen-bag [data-slot="${slot}"].filled`);
    assert(await withinFrames(UI_FRAMES, () => view() !== null), 'the tool does not show');
    const box = view()!.getBoundingClientRect();
    const at = { clientX: box.left + 4, clientY: box.top + 4, bubbles: true };
    view()!.dispatchEvent(new PointerEvent('pointermove', at));
    view()!.dispatchEvent(new PointerEvent('pointerover', at));
    const bubble = document.querySelector<HTMLElement>('#ui-tooltip');
    assert(bubble && !bubble.hidden, 'no bubble over the hovered tool');
    assert(
      bubble.textContent?.includes(t(tool.nameKey)),
      `the bubble says "${bubble.textContent}"`,
    );
    // Every page, the same panel.
    const panel = document.querySelector<HTMLElement>('#screen-bag .bag-panel')!;
    const sizes = new Set<string>();
    for (const page of ['inventory', 'logbook', 'bestiary', 'quests', 'status']) {
      document.querySelector<HTMLElement>(`#screen-bag [data-page="${page}"]`)!.click();
      await frameOrFail();
      const r = panel.getBoundingClientRect();
      sizes.add(`${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    assert(sizes.size === 1, `the Bag changes size with its page: ${[...sizes].join(', ')}`);
    app.inventory!.closeScreen();
  },
};

const bookCase: SelftestCase = {
  name: 'a journal in hand is read on secondary in its book, closed by the Bag’s key',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    await standAt(app, SPOT);
    const journal = app.registry!.pack.items?.find((item) => item.lore);
    assert(journal?.lore, 'the pack has no journal');
    give(app, journal.key, 1);
    app.inventory!.closeScreen();
    app.input!.slot = session.player.inventory.findIndex((stack) => stack?.item === journal.key);
    press(app, 'secondary', 1);
    session.step(1);
    assert(app.inventory!.screen() === 'book', `secondary opened ${app.inventory!.screen()}`);
    const first = t(journal.lore).split('\n')[0]!;
    assert(app.inventory!.book.shownText().includes(first), 'the book does not show the journal');
    tap('KeyE', 'e');
    assert(app.inventory!.screen() === null, 'E did not close the book');
    app.input!.slot = 0;
  },
};

const rowsCase: SelftestCase = {
  name: 'the gauges show as rows of symbols over the hotbar, filled by halves',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const s = session.player.survival;
    const health = s.health;
    // A vital cell is a tenth of the base health; vitality (an earlier suite) adds cells.
    const unit = app.registry!.pack.balance.health.max / ROW_ICONS;
    const cells = Math.ceil(s.healthMax / unit);
    s.health = 4.5 * unit;
    try {
      const fills = () =>
        [...document.querySelectorAll<HTMLElement>('#hud-vitals .row-health .stat-icon')]
          .filter((icon) => !icon.hidden)
          .map((icon) => icon.style.getPropertyValue('--fill'));
      const expected = ['1', '1', '1', '1', '0.5', ...new Array(cells - 5).fill('0')];
      assert(
        await withinFrames(UI_FRAMES, () => fills().join() === expected.join()),
        `the health row shows ${fills().join(' ')}`,
      );
      assert(fills().length === cells, `not a row of ${cells} symbols`);
      // Over the hotbar.
      const rows = document.getElementById('hud-vitals')!.getBoundingClientRect();
      const hotbar = document.querySelector('.hotbar')!.getBoundingClientRect();
      assert(rows.bottom <= hotbar.top + 1, 'the rows are not over the hotbar');
    } finally {
      s.health = health;
    }
  },
};

export const M28_SUITE: readonly SelftestCase[] = [
  questNewsCase,
  bubbleCase,
  bookCase,
  rowsCase,
  noErrorsCase('no errors after the m28 checks'),
];
