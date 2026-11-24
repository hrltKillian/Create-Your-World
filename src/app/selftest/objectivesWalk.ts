import type { ObjectiveDef } from '../../content/schema.ts';
import { t } from '../../i18n/i18n.ts';
import { POINT_BEARINGS } from '../../ui/hud/compass.ts';
import type { App } from '../App.ts';
import { look, withinFrames } from '../automation.ts';
import { walkObjectivesHere } from '../walkAutomation.ts';
import { assert, PLAY_SCENES, playerSession, SEARCH_RADIUS, type SelftestCase } from './support.ts';
import { needsGeneratedFixedPlayer } from './survivalScenes.ts';

/**
 * M11 « Fait quand »: a scripted run (teleports and real actions through `__game`'s automation)
 * does each objective in order. The walk of sim/testing/objectiveWalk.ts in the generated world
 * with fixed steps (?seed=7&rd=4&fixedStep=1), driven by walkAutomation.ts (the hook's helpers):
 * teleports, debug gives and fills, crafts queued as the Logbook does, stations placed (secondary
 * held at the floor the view aims at) and fed through their screens, a sip at a pool, a night
 * held out in a cabin, journeys to the biomes of the raw items (findBiome), a creature killed for
 * its loot. After each objective the HUD's panel shows the next one, and the compass its point
 * when it has one. It needs a player who has done no objective and leaves a cabin at the spawn
 * and the clock a day on: run it in its own boot, right after m0.
 * tests/unit/sim/objectiveWalk.test.ts runs the same walk on an inline simulation of seed 7.
 */

/** Frames the HUD (10 Hz, or the next frame after an event) gets to show a change. */
const UI_FRAMES = 30;

/** The walk starts the chain: a player who has done no objective yet. */
function needsFreshPlayer(app: App): string | null {
  const done = app.session?.player.objectives.length ?? 0;
  return done > 0
    ? `needs a player who has done no objective (${done} done: run it after m0)`
    : null;
}

/** The objectives panel shows an objective (none: the chain done), the compass its point. */
async function hudShows(app: App, objective: ObjectiveDef | undefined): Promise<void> {
  const text = objective ? t(objective.textKey) : t('hud.objectivesDone');
  const reads = () => document.querySelector('#hud-objectives .objectives-text')?.textContent;
  const shown = await withinFrames(UI_FRAMES, () => reads() === text);
  assert(shown, `the objectives panel reads "${reads()}", not "${text}"`);
  if (!objective?.compass) return;
  // headingOf(yaw) = −yaw: facing a bearing is the opposite yaw.
  look(app, -POINT_BEARINGS[objective.compass], 0);
  const mark = document.querySelector<HTMLElement>('#hud-compass .compass-objective');
  const front = () => Number(mark?.style.getPropertyValue('--o')) > 0.5;
  assert(
    await withinFrames(UI_FRAMES, front),
    `facing ${objective.compass}, the compass shows no mark for ${objective.key}`,
  );
}

export const OBJECTIVES_WALK_CASES: readonly SelftestCase[] = [
  {
    name: 'a scripted walk does every objective of the pack in chain order, the HUD following',
    scenes: PLAY_SCENES,
    timeoutMs: 240_000,
    skip: (app) => needsGeneratedFixedPlayer(app) ?? needsFreshPlayer(app),
    run: async (app) => {
      await playerSession(app);
      const chain = app.registry!.pack.objectives ?? [];
      assert(chain.length > 0, 'the pack has no objectives');
      await hudShows(app, chain[0]);
      const done = await walkObjectivesHere(app, SEARCH_RADIUS, (_, index) =>
        hudShows(app, chain[index + 1]),
      );
      const keys = chain.map((o) => o.key).join(', ');
      assert(done.join(', ') === keys, `the walk did [${done.join(', ')}], not [${keys}]`);
    },
  },
];
