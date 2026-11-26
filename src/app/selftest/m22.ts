import { t } from '../../i18n/i18n.ts';
import type { PlayerState } from '../../sim/player.ts';
import { xpToNext } from '../../sim/progression.ts';
import { click, withinFrames } from '../automation.ts';
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
 * M22 progression (plan v3 « M22 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): U opens the Bag's Status page, where a level's point is spent
 * by its « + » (vitality: the largest health grows); the Quests page lists the tasks held, and a
 * task done is claimed for its XP. Numbers come from the pack's balance.
 */

const SPOT = { x: -60, z: 60 };

const statusCase: SelftestCase = {
  name: 'U shows the Status page; a point spent by its button raises health; a done task pays XP',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    await standAt(app, SPOT);
    const player = session.player;
    const b = app.registry!.pack.balance;
    const p = b.progression;
    session.step(31);
    app.inventory!.closeScreen();
    // Two levels' XP, as claimed quests would give it (staged on the player's state).
    (player as PlayerState).xp += xpToNext(1, p) + xpToNext(2, p);
    tap('KeyU', 'u');
    assert(app.inventory!.bag.shown() === 'status', 'U did not open the Status page');
    const spend = '#screen-bag [data-action="skill-spend"][data-skill="vitality"]';
    const enabled = () => document.querySelector<HTMLButtonElement>(spend)?.disabled === false;
    assert(await withinFrames(UI_FRAMES, enabled), 'the vitality « + » is not enabled');
    const before = player.survival.healthMax;
    assert(click(spend), 'no vitality « + »');
    session.step(1);
    assert(
      player.survival.healthMax === before + p.skills.vitality,
      `the largest health is ${player.survival.healthMax}`,
    );
    // In vital cells (plan v3 « M30 »): a tenth of the health each, with its symbol.
    const cells = p.skills.vitality / (b.health.max / 10);
    const rule =
      t('skill.vitality.rule', { total: cells }) + t('skill.vitality.after', { each: cells });
    const page = () => document.querySelector('#screen-bag .status');
    const shows = () =>
      page()?.textContent?.includes(rule) && page()?.querySelector('.mini-icon.gauge-health');
    assert(await withinFrames(UI_FRAMES, () => !!shows()), 'the rule does not show');
    // A task done, claimed by its button.
    tap('KeyJ', 'j');
    const task = player.tasks[0];
    const def = app.registry!.pack.tasks?.find((d) => d.key === task?.key);
    assert(task && def, 'no task held');
    task.progress = def.counter.count;
    const claim = `#screen-bag [data-task="${def.key}"] [data-action="task-claim"]`;
    const xp = player.xp;
    assert(await withinFrames(UI_FRAMES, () => click(claim)), 'no Claim button on the task');
    session.step(1);
    assert(player.xp === xp + def.xp, `the claim gave ${player.xp - xp} XP, not ${def.xp}`);
    tap('KeyJ', 'j');
    assert(app.inventory!.screen() === null, 'J on the Quests page did not close it');
  },
};

export const M22_SUITE: readonly SelftestCase[] = [
  statusCase,
  noErrorsCase('no errors after the m22 checks'),
];
