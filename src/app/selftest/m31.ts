import { t } from '../../i18n/i18n.ts';
import { TICKS_PER_SECOND } from '../../sim/clock.ts';
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
 * M31 the detailed map (plan v3 « M31 », the fourth play test), on the flat world with fixed
 * steps (?worldType=flat&fixedStep=1): the minimap says where the player stands; the big map is
 * dragged with the mouse; a click picks a place, where « Mark » sets a waypoint of the symbol and
 * colour chosen; the list shows its coordinates; only M closes the map.
 */

const SPOT = { x: -150, z: 40 };

const mapCase: SelftestCase = {
  name: 'the big map is dragged; a click picks where a waypoint of a chosen symbol goes',
  scenes: PLAY_SCENES,
  skip: needsFlatPlayer,
  run: async (app) => {
    const session = await playerSession(app);
    const player = session.player;
    await standAt(app, SPOT);
    session.step(TICKS_PER_SECOND + 1);
    app.inventory!.closeScreen();
    // The minimap says where the player stands.
    const coords = t('hud.mapKey', { key: app.input!.keyLabel('map'), x: SPOT.x, z: SPOT.z });
    const hint = () => document.querySelector('#hud-map .minimap-hint')?.textContent;
    assert(await withinFrames(UI_FRAMES, () => hint() === coords), `the minimap says ${hint()}`);
    tap('KeyM', 'm');
    assert(app.inventory!.screen() === 'map', 'M did not open the big map');
    // The Bag's keys leave it open.
    tap('KeyE', 'e');
    assert(app.inventory!.screen() === 'map', 'E closed the big map');
    const canvas = document.querySelector<HTMLCanvasElement>('#screen-map .map-canvas')!;
    const box = canvas.getBoundingClientRect();
    const k = box.width / canvas.width;
    const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const pointer = (type: string, dx: number, dy: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, { clientX: middle.x + dx * k, clientY: middle.y + dy * k }),
      );
    // Dragged 40 blocks east and 20 south: the centre goes the other way.
    pointer('pointerdown', 0, 0);
    pointer('pointermove', 20, 10);
    pointer('pointermove', 40, 20);
    pointer('pointerup', 40, 20);
    const map = app.inventory!.map;
    const centre = map.centreFor(player.body.x, player.body.z);
    assert(
      centre.x === SPOT.x - 40 && centre.z === SPOT.z - 20,
      `the map is centred on ${centre.x}, ${centre.z}`,
    );
    await withinFrames(2, () => false);
    // A click 10 blocks east of the centre picks that place.
    pointer('pointerdown', 10, -5);
    pointer('pointerup', 10, -5);
    const picked = { x: centre.x + 10, z: centre.z - 5 };
    click('#screen-map [data-icon="star"]');
    click('#screen-map [data-colour="4"]');
    const name = document.querySelector<HTMLInputElement>(
      '#screen-map [data-action="waypoint-name"]',
    )!;
    name.value = 'Selftest star';
    assert(click('#screen-map [data-action="waypoint-add"]'), 'no « Mark » button');
    session.step(1);
    const marked = player.waypoints.at(-1);
    assert(
      marked?.name === 'Selftest star' &&
        marked.icon === 'star' &&
        marked.colour === 4 &&
        marked.x === picked.x &&
        marked.z === picked.z,
      `the waypoint is ${JSON.stringify(marked)}`,
    );
    const index = player.waypoints.length - 1;
    const row = () => document.querySelector(`#screen-map [data-waypoint="${index}"]`);
    assert(
      await withinFrames(UI_FRAMES, () => !!row()?.textContent?.includes(`X ${picked.x}`)),
      'the list does not show its coordinates',
    );
    click(`#screen-map [data-waypoint="${index}"] [data-action="waypoint-remove"]`);
    session.step(1);
    tap('KeyM', 'm');
    assert(app.inventory!.screen() === null, 'M did not close the big map');
  },
};

export const M31_SUITE: readonly SelftestCase[] = [
  mapCase,
  noErrorsCase('no errors after the m31 checks'),
];
