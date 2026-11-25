import type { QuestDef } from '../../content/schema.ts';
import { POINT_BEARINGS } from '../../ui/hud/compass.ts';
import { questLine } from '../../ui/quests.ts';
import type { App } from '../App.ts';
import { freshWorld, look, sendAndStep, withinFrames } from '../automation.ts';
import { walkQuestsHere } from '../walkAutomation.ts';
import { assert, PLAY_SCENES, playerSession, SEARCH_RADIUS, type SelftestCase } from './support.ts';
import { needsGeneratedFixedPlayer } from './survivalScenes.ts';

/**
 * M11 « Fait quand », with M21's quests: a scripted run (teleports and real actions through
 * `__game`'s automation) does each quest of the pack in its order. The walk of
 * sim/testing/questWalk.ts in the generated world with fixed steps (?seed=7&rd=4&fixedStep=1),
 * driven by walkAutomation.ts (the hook's helpers: the view turned to a point, primary, secondary
 * or forward held): the items a quest names broken out of the world with the right tool and
 * walked onto (ores in their biome, found by findBiome), creatures struck down with a spear,
 * crafts queued as the Logbook does, stations placed and fed through their screens, a sip at a
 * pool, journeys through biomes, a cabin built block by block and a night held out in it; debug
 * commands only stage the rest (docs M11 « Retenu à l'intégration »). A quest with a compass point,
 * once done, is pinned: the line under the compass names it and the compass shows its point. It
 * needs a player who has done no quest: after earlier suites of the boot did some (m9 under
 * `?selftest=all`), it walks in a new world of the same seed. It leaves a cabin at the spawn and
 * the clock a day on.
 * tests/unit/sim/questWalk.test.ts runs the same walk on inline simulations of several seeds.
 */

/** Frames the HUD (10 Hz, or the next frame after an event) gets to show a change. */
const UI_FRAMES = 30;

/** Pins a quest with a compass point: the line under the compass and the point show it. */
async function pinShows(app: App, quest: QuestDef): Promise<void> {
  if (!quest.compass) return;
  sendAndStep(app, { type: 'quest.pin', quest: quest.key });
  const text = questLine(quest, app.session!.player.quests[quest.key]);
  const reads = () => document.querySelector('#hud-quest')?.textContent;
  assert(
    await withinFrames(UI_FRAMES, () => reads() === text),
    `the pinned line reads "${reads()}"`,
  );
  // headingOf(yaw) = −yaw: facing a bearing is the opposite yaw.
  look(app, -POINT_BEARINGS[quest.compass], 0);
  const mark = document.querySelector<HTMLElement>('#hud-compass .compass-quest');
  const front = () => Number(mark?.style.getPropertyValue('--o')) > 0.5;
  assert(
    await withinFrames(UI_FRAMES, front),
    `facing ${quest.compass}, the compass shows no mark for ${quest.key}`,
  );
  sendAndStep(app, { type: 'quest.pin', quest: null });
}

export const QUESTS_WALK_CASES: readonly SelftestCase[] = [
  {
    name: 'a scripted walk does every quest of the pack in its order, a pinned one on the compass',
    scenes: PLAY_SCENES,
    timeoutMs: 300_000,
    skip: needsGeneratedFixedPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      // The walk starts the graph: a player who has done no quest yet.
      if (Object.values(session.player.quests).some((q) => q.done)) await freshWorld(app);
      const quests = app.registry!.pack.quests ?? [];
      assert(quests.length > 0, 'the pack has no quests');
      const done = await walkQuestsHere(app, SEARCH_RADIUS, (quest) => pinShows(app, quest));
      const keys = quests.map((q) => q.key).sort();
      const walked = [...done].sort();
      assert(walked.join(', ') === keys.join(', '), `the walk did [${walked.join(', ')}]`);
    },
  },
];
