import { blockItemKey } from '../../content/items.ts';
import { TICKS_PER_SECOND } from '../../sim/clock.ts';
import { fallDamage } from '../../sim/survival.ts';
import { UNEXPLORED } from '../../ui/mapCanvas.ts';
import {
  blockKey,
  click,
  fill,
  give,
  look,
  press,
  waitForChunks,
  withinFrames,
} from '../automation.ts';
import {
  aimAt,
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
 * M27 exploration (plan v3 « M27 »), on the flat world with fixed steps
 * (?worldType=flat&fixedStep=1): a ladder placed by secondary on a wall is climbed with forward
 * and slid down unhurt; a trapdoor opens and closes on secondary; the HUD's minimap draws the land
 * walked, M shows the big map, where a waypoint marked by its button shows on the compass from
 * afar and is removed by its button. The ladder and the trapdoor are found through the pack's data.
 */

const LADDER_SPOT = { x: -90, z: -90 };
const MAP_SPOT = { x: -120, z: -90 };
/** How far the player walks away from the waypoint before looking for it on the compass. */
const AWAY = 40;

const ladderCase: SelftestCase = {
  name: 'a ladder on a wall is climbed and slid down unhurt; a trapdoor opens and closes',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const registry = app.registry!;
    const blocks = registry.pack.blocks;
    const ladder = blocks.find((b) => b.climbable);
    // The hatch: opened by secondary like a gate, but one cell high.
    const hatch = blocks.find((b) => b.states?.includes('open') && !b.states.includes('half'));
    assert(ladder && hatch, 'the pack has no ladder or no trapdoor');
    await standAt(app, LADDER_SPOT);
    await waitForChunks(app, 1, 15_000);
    const player = session.player;
    const feet = Math.floor(player.body.y);
    const { x, z } = LADDER_SPOT;
    const stone = stateKey(app, registry.defaultState(registry.pack.worldgen!.stone));
    fill(app, x - 1, feet, z - 1, x + 1, feet + 10, z - 1, stone);
    // The first rung placed by secondary on the wall's face, the others like it.
    give(app, blockItemKey(ladder.key), 1);
    app.input!.slot = player.inventory.findIndex((s) => s?.item === blockItemKey(ladder.key));
    await aimAt(app, { x, y: feet + 1, z: z - 1 });
    press(app, 'secondary', 1);
    session.step(1);
    const rung = blockKey(app, x, feet + 1, z);
    assert(rung?.startsWith(ladder.key), `secondary on the wall placed ${rung}`);
    fill(app, x, feet, z, x, feet + 8, z, rung!);
    // Forward against the wall climbs.
    look(app, 0, 0);
    press(app, 'forward', TICKS_PER_SECOND * 2);
    const climbed = player.body.y - feet;
    assert(climbed > 3, `two seconds of forward on the ladder climbed ${climbed.toFixed(2)}`);
    // Let go: a slow slide down, no fall damage.
    const balance = registry.pack.balance;
    const falls = eventsDuring(app, () => session.step(TICKS_PER_SECOND * 6)).flatMap((event) =>
      event.type === 'playerLanded' ? [event.fall] : [],
    );
    assert(player.body.onGround, 'the player is not back on the ground');
    const harm = falls.reduce((sum, fall) => sum + fallDamage(fall, balance), 0);
    assert(harm === 0, `the slide hurt: falls of ${falls.join(', ')} blocks`);
    // A trapdoor in the floor beside the ladder, opened and closed by secondary.
    const hatchCell = { x: x + 1, y: feet - 1, z: z + 1 };
    const closed = stateKey(app, registry.defaultState(hatch.key));
    fill(app, hatchCell.x, hatchCell.y, hatchCell.z, hatchCell.x, hatchCell.y, hatchCell.z, closed);
    // Seen from above, one cell south: the hatch's top first.
    await standAt(app, { x: x + 1, z: z + 2 });
    await aimAt(app, hatchCell);
    const open = () => registry.prop(app.world!.getBlock(x + 1, feet - 1, z + 1), 'open');
    press(app, 'secondary', 1);
    session.step(1);
    assert(open() === '1', 'secondary did not open the trapdoor');
    await aimAt(app, hatchCell);
    press(app, 'secondary', 1);
    session.step(1);
    assert(open() === '0', 'secondary did not close the trapdoor');
  },
};

/** Whether the middle of a map canvas is drawn (not the colour of the unexplored land). */
function drawnInMiddle(selector: string): boolean {
  const canvas = document.querySelector<HTMLCanvasElement>(selector);
  const g = canvas?.getContext('2d');
  if (!canvas || !g) return false;
  const [r, gr, b] = g.getImageData(canvas.width / 2, canvas.height / 2 + 6, 1, 1).data;
  return ((r! << 16) | (gr! << 8) | b!) !== UNEXPLORED;
}

const mapCase: SelftestCase = {
  name: 'the HUD shows the minimap; M the big map, where a waypoint marked shows on the compass',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const player = session.player;
    await standAt(app, MAP_SPOT);
    session.step(TICKS_PER_SECOND + 1);
    app.inventory!.closeScreen();
    // The minimap draws the land walked around the player, always.
    const mini = '#hud-map .minimap-canvas';
    assert(await withinFrames(UI_FRAMES, () => drawnInMiddle(mini)), 'the minimap is not drawn');
    tap('KeyM', 'm');
    assert(app.inventory!.screen() === 'map', 'M did not open the big map');
    const big = '#screen-map .map-canvas';
    assert(await withinFrames(UI_FRAMES, () => drawnInMiddle(big)), 'the big map is not drawn');
    const name = document.querySelector<HTMLInputElement>(
      '#screen-map [data-action="waypoint-name"]',
    );
    assert(name, 'no waypoint name box');
    name.value = 'Selftest camp';
    assert(click('#screen-map [data-action="waypoint-add"]'), 'no « Mark this place » button');
    session.step(1);
    const marked = player.waypoints.at(-1);
    assert(marked?.name === 'Selftest camp', `the waypoint is ${JSON.stringify(marked)}`);
    tap('KeyM', 'm');
    assert(app.inventory!.screen() === null, 'M on the big map did not close it');
    // From afar, facing it: its mark shows on the compass.
    await standAt(app, { x: MAP_SPOT.x, z: MAP_SPOT.z + AWAY });
    look(app, 0, 0);
    const shown = () =>
      [...document.querySelectorAll<HTMLElement>('#hud-compass .compass-waypoint')].some(
        (mark) => Number(mark.style.getPropertyValue('--o')) > 0.5,
      );
    assert(await withinFrames(UI_FRAMES, shown), 'no waypoint mark on the compass');
    // Removed by its button: the mark goes.
    tap('KeyM', 'm');
    const index = player.waypoints.length - 1;
    const remove = `#screen-map [data-waypoint="${index}"] [data-action="waypoint-remove"]`;
    assert(await withinFrames(UI_FRAMES, () => click(remove)), 'no « Remove » on the waypoint');
    session.step(1);
    assert(!player.waypoints.some((w) => w.name === 'Selftest camp'), 'the waypoint stayed');
    tap('KeyM', 'm');
    assert(await withinFrames(UI_FRAMES, () => !shown()), 'the removed waypoint still shows');
  },
};

export const M27_SUITE: readonly SelftestCase[] = [
  ladderCase,
  mapCase,
  noErrorsCase('no errors after the m27 checks'),
];
