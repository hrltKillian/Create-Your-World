import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { addStrings, i18nMissing } from '../../../src/i18n/i18n.ts';
import type { Command } from '../../../src/sim/commands.ts';
import type { MapView } from '../../../src/ui/map.ts';
import { MapScreen } from '../../../src/ui/screens/mapScreen.ts';
import { type FakeElement, installFakeDom, removeFakeDom } from '../../helpers/fakeDom.ts';

/*
 * The big map's screen (plan v3 « M31 »): dragged with the mouse (a block a pixel), a click picks
 * the place of the next waypoint, marked with the symbol and colour chosen; the waypoints listed
 * with their coordinates and distance; « Show » centres the map on one, « Centre on me » back.
 */

beforeEach(installFakeDom);
afterEach(removeFakeDom);
addStrings(basePack.strings);

const fake = (element: HTMLElement) => element as unknown as FakeElement;

function setup() {
  const sent: Command[] = [];
  const screen = new MapScreen({ send: (c) => sent.push(c), click: () => {} }, () => 'M');
  const view: MapView = {
    centreX: 10,
    centreZ: 20,
    columns: [],
    player: { x: 10.5, z: 20.5, yaw: 0 },
    waypoints: [{ name: 'Camp', x: 40, z: 60, icon: 'home', colour: 1 }],
  };
  screen.open();
  screen.update(view);
  const canvas = fake(screen.element).querySelector('.map-canvas')!;
  const find = (attr: string, value: string) =>
    fake(screen.element).findAll((e) => e.getAttribute(attr) === value)[0]!;
  return { screen, sent, canvas, find, view };
}

describe('MapScreen', () => {
  it('lists the waypoints with their symbol, coordinates and distance', () => {
    const { screen } = setup();
    const row = fake(screen.element).findAll((e) => e.getAttribute('data-waypoint') === '0')[0]!;
    expect(row.textContent).toContain('Camp');
    expect(row.textContent).toContain('X 40 · Z 60 · 50 blocks away');
    expect(i18nMissing()).toEqual([]);
  });

  it('is dragged a block a pixel; a click picks the place of the next waypoint', () => {
    const { screen, sent, canvas, find, view } = setup();
    expect(screen.centreFor(10.5, 20.5)).toEqual({ x: 10, z: 20 });
    canvas.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    canvas.dispatch('pointermove', { clientX: 130, clientY: 90 });
    canvas.dispatch('pointerup', { clientX: 130, clientY: 90 });
    // The land follows the pointer: the centre goes the other way.
    expect(screen.centreFor(10.5, 20.5)).toEqual({ x: -20, z: 30 });
    expect(screen.stale).toBe(true);
    screen.update(view);
    // A click (no drag): the block under it, from the drawn view's centre.
    canvas.dispatch('pointerdown', { clientX: 256 + 5, clientY: 256 - 3 });
    canvas.dispatch('pointerup', { clientX: 256 + 5, clientY: 256 - 3 });
    expect(fake(screen.element).querySelector('.map-where')!.textContent).toContain('X 15 · Z 17');
    find('data-icon', 'cave').dispatch('click');
    find('data-colour', '3').dispatch('click');
    (fake(screen.element).querySelector('.map-name') as unknown as { value: string }).value =
      'Hole';
    find('data-action', 'waypoint-add').dispatch('click');
    expect(sent).toEqual([
      { type: 'waypoint.add', name: 'Hole', icon: 'cave', colour: 3, x: 15, z: 17 },
    ]);
    // Nothing picked any more: the next one goes at the feet.
    find('data-action', 'waypoint-add').dispatch('click');
    expect(sent[1]).toEqual({ type: 'waypoint.add', name: '', icon: 'cave', colour: 3 });
  });

  it('zooms about the pointer, picks places a zoomed block at a time and drags by blocks', () => {
    const { screen, canvas, find, view } = setup();
    const label = () => fake(screen.element).querySelector('.map-zoom')!.textContent;
    expect(label()).toBe('×1');
    // The wheel up over the block (15, 17): it stays under the pointer, 2 pixels a block.
    const wheel = { clientX: 256 + 5, clientY: 256 - 3, deltaY: -100, preventDefault: () => {} };
    canvas.dispatch('wheel', wheel);
    expect(label()).toBe('×2');
    const centre = screen.centreFor(10.5, 20.5);
    expect(centre).toEqual({ x: 13, z: 19 });
    screen.update({ ...view, centreX: centre.x, centreZ: centre.z });
    canvas.dispatch('pointerdown', { clientX: 256 + 5, clientY: 256 - 3 });
    canvas.dispatch('pointerup', { clientX: 256 + 5, clientY: 256 - 3 });
    expect(fake(screen.element).querySelector('.map-where')!.textContent).toContain('X 15 · Z 17');
    // Up to 8 pixels a block with « + », never past it.
    for (let i = 0; i < 4; i++) find('data-action', 'map-zoom-in').dispatch('click');
    expect(label()).toBe('×8');
    // A drag of 80 pixels moves 10 blocks.
    const before = screen.centreFor(10.5, 20.5);
    canvas.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    canvas.dispatch('pointermove', { clientX: 180, clientY: 100 });
    canvas.dispatch('pointerup', { clientX: 180, clientY: 100 });
    expect(screen.centreFor(10.5, 20.5)).toEqual({ x: before.x - 10, z: before.z });
    // Back out to a pixel a block with « − ».
    for (let i = 0; i < 4; i++) find('data-action', 'map-zoom-out').dispatch('click');
    expect(label()).toBe('×1');
  });

  it('centres on a waypoint with « Show », and back on the player', () => {
    const { screen, find } = setup();
    find('data-action', 'waypoint-show').dispatch('click');
    expect(screen.centreFor(10.5, 20.5)).toEqual({ x: 40, z: 60 });
    find('data-action', 'map-centre').dispatch('click');
    expect(screen.centreFor(10.5, 20.5)).toEqual({ x: 10, z: 20 });
  });
});
