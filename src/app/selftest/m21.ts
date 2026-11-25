import { t } from '../../i18n/i18n.ts';
import type { App } from '../App.ts';
import { click, give, withinFrames } from '../automation.ts';
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
 * M21 quests (plan v3 « M21 »), on the flat world with fixed steps (?worldType=flat&fixedStep=1):
 * J opens the Bag's Quests page on the branches open from the start; a quest whose state was
 * reached before its unlock is done as it unlocks, the HUD saying so; a quest done is claimed by
 * its button for its rewards; an open one pinned shows under the compass. Quests come from the
 * pack's data: the first one, and the first that requires it.
 */

const SPOT = { x: 50, z: 50 };

/** The quest card of a key on the Quests page, or null. */
const card = (key: string) => document.querySelector(`#screen-bag [data-quest="${key}"]`);

/** Steps past the next quest check (once a second). */
function nextCheck(app: App): void {
  app.session!.step(31);
}

const questsCase: SelftestCase = {
  name: 'J shows the open quests; one done ahead is done at its unlock; a claim pays; a pin shows',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    await standAt(app, SPOT);
    const quests = app.registry!.pack.quests ?? [];
    const first = quests[0];
    const next = quests.find((q) => q.requires?.includes(first?.key ?? 'quest:'));
    assert(first?.condition?.items && next?.condition?.items, 'no item quest and its follower');
    const player = session.player;
    app.inventory!.closeScreen();
    nextCheck(app);
    tap('KeyJ', 'j');
    assert(app.inventory!.bag.shown() === 'quests', 'J did not open the Quests page');
    assert(await withinFrames(UI_FRAMES, () => card(first.key) !== null), 'no card for the first');
    assert(card(next.key) === null, `${next.key} shows before its unlock`);
    // The follower's state first: it does not count while locked, then is done as it unlocks.
    if (!player.quests[first.key]?.done) {
      for (const item of next.condition.items) give(app, item, 1);
      nextCheck(app);
      assert(!player.quests[next.key], `${next.key} unlocked too early`);
      for (const item of first.condition.items) give(app, item, 1);
      nextCheck(app);
      assert(player.quests[next.key]?.done === true, `${next.key} was not done at its unlock`);
      const hint = () => document.getElementById('hud-hint')?.textContent ?? '';
      const already = t('hud.questAlready', { name: t(next.textKey) });
      const said = await withinFrames(UI_FRAMES, () => hint().includes(already));
      assert(said, `the HUD says "${hint()}", not "${already}"`);
    }
    // A claim by the button gives the rewards once.
    const reward = first.rewards?.[0];
    const owned = () =>
      player.inventory.reduce((n, s) => n + (s && s.item === reward?.item ? s.count : 0), 0);
    const before = owned();
    const claim = `#screen-bag [data-quest="${first.key}"] [data-action="quest-claim"]`;
    assert(await withinFrames(UI_FRAMES, () => click(claim)), 'no Claim button on the first');
    session.step(1);
    assert(player.quests[first.key]?.claimed === true, 'the claim was not taken');
    if (reward) assert(owned() - before === reward.count, `the claim gave ${owned() - before}`);
    // An open quest pinned shows under the compass, unpinned it goes.
    const open = quests.find((q) => player.quests[q.key] && !player.quests[q.key]!.done);
    assert(open, 'no open quest to pin');
    const pin = `#screen-bag [data-quest="${open.key}"] [data-action="quest-pin"]`;
    assert(await withinFrames(UI_FRAMES, () => click(pin)), 'no Pin button');
    session.step(1);
    const line = document.getElementById('hud-quest');
    const shown = () => line?.hidden === false && line.textContent?.startsWith(t(open.textKey));
    assert(await withinFrames(UI_FRAMES, () => shown() === true), 'the pinned quest does not show');
    assert(await withinFrames(UI_FRAMES, () => click(pin)), 'no Unpin button');
    session.step(1);
    assert(await withinFrames(UI_FRAMES, () => line?.hidden === true), 'the line stays');
    tap('KeyJ', 'j');
    assert(app.inventory!.screen() === null, 'J on the Quests page did not close it');
  },
};

export const M21_SUITE: readonly SelftestCase[] = [
  questsCase,
  noErrorsCase('no errors after the m21 checks'),
];
