import { describe, expect, it } from 'vitest';
import { MapModel } from '../../../src/app/mapModel.ts';
import { generatePackTexture } from '../../../src/assets/procedural/patterns.ts';
import { COLLISION_BOXES, COLLISION_NONE } from '../../../src/content/registry.ts';
import { TICKS_PER_SECOND } from '../../../src/sim/clock.ts';
import {
  EXPLORE_RADIUS,
  exploredKey,
  MAX_WAYPOINTS,
  WAYPOINT_COLOURS,
} from '../../../src/sim/exploration.ts';
import { PHYSICS } from '../../../src/sim/physics.ts';
import { playerRecord, readPlayer } from '../../../src/sim/playerRecords.ts';
import { BIG_MAP_RADIUS, MAP_CELLS } from '../../../src/ui/map.ts';
import { blockToColumn } from '../../../src/world/coords.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim, rejections } from '../../helpers/simHarness.ts';

/*
 * Exploration (plan v3 « M27 »): ladders climbed and slid down without a fall's harm, trapdoors
 * opened by secondary, the columns explored, the waypoints marked and the map's colours.
 */

/** The pack's textures (RGBA bytes), as the game loads them. */
function packLayers(): Uint8Array[] {
  const pack = registry.pack;
  return pack.textures.map((def) => generatePackTexture(def, pack.manifest.textureSize));
}

describe('ladders and trapdoors', () => {
  it('climbs a ladder with forward, slides down it slowly, and lands unhurt', () => {
    const s = playerTestSim({ seed: 'ladder' });
    // A stone wall north of the player, a ladder 12 high against it.
    s.fill(-1, 65, -1, 1, 80, -1, 'block:stone');
    s.fill(0, 65, 0, 0, 77, 0, 'block:ladder[attach=n]');
    s.send({ type: 'debug.teleport', x: 0.5, y: 65, z: 0.5 });
    const y0 = s.player.body.y;
    s.tick(TICKS_PER_SECOND * 2, { forward: 1, yaw: 0 });
    expect(s.player.body.y - y0).toBeGreaterThan(PHYSICS.climb * 1.5);
    const top = s.player.body.y;
    s.tick(5);
    // Nothing held: no faster than the slide.
    expect(s.player.body.vy).toBeGreaterThanOrEqual(-PHYSICS.climbSlide);
    expect(s.player.body.y).toBeLessThan(top);
    s.tick(TICKS_PER_SECOND * 6);
    expect(s.player.body.onGround).toBe(true);
    expect(s.player.survival.health).toBe(100);
  });

  it('opens and closes a trapdoor with secondary: closed it is a floor, open a hole', () => {
    const s = playerTestSim({ seed: 'trapdoor' });
    s.put(1, 64, 0, 'block:trapdoor[facing4=n,open=0]');
    const collision = () => registry.tables.collision[s.sim.world.getBlock(1, 64, 0)]!;
    const door = { x: 1, y: 64, z: 0, face: 2 };
    expect(collision()).toBeGreaterThanOrEqual(COLLISION_BOXES);
    s.tick(1, { secondary: true, target: door });
    expect(s.block(1, 64, 0)).toBe('block:trapdoor[facing4=n,open=1]');
    expect(collision()).toBe(COLLISION_NONE);
    s.tick(1, { secondary: false, target: door });
    s.tick(1, { secondary: true, target: door });
    expect(s.block(1, 64, 0)).toBe('block:trapdoor[facing4=n,open=0]');
  });
});

describe('exploration and waypoints', () => {
  it('explores the columns around the player, once a second', () => {
    const s = playerTestSim({ seed: 'explore' });
    const b = s.player.body;
    const [cx, cz] = [blockToColumn(b.x), blockToColumn(b.z)];
    s.step(TICKS_PER_SECOND);
    expect(s.player.explored[exploredKey(cx + EXPLORE_RADIUS, cz)]).toBe(true);
    expect(s.player.explored[exploredKey(cx + EXPLORE_RADIUS + 1, cz)]).toBeUndefined();
    expect(Object.keys(s.player.explored)).toHaveLength((2 * EXPLORE_RADIUS + 1) ** 2);
  });

  it('marks waypoints at the feet or a picked place, with a symbol and a colour; at most eight', () => {
    const s = playerTestSim({ seed: 'waypoints' });
    const add = (
      name: string,
      more: Partial<{ x: number; z: number; icon: string; colour: number }> = {},
    ) => s.send({ type: 'waypoint.add', name, icon: 'home', colour: 2, ...more });
    expect(eventsOf(add(' Home '), 'waypointsChanged')).toHaveLength(1);
    expect(s.player.waypoints).toEqual([{ name: 'Home', x: 0, z: 0, icon: 'home', colour: 2 }]);
    add('', { x: 40, z: -12, icon: 'cave', colour: 0 });
    expect(s.player.waypoints[1]).toEqual({
      name: '40, -12',
      x: 40,
      z: -12,
      icon: 'cave',
      colour: 0,
    });
    // Refused: an unknown symbol, a colour out of the palette, a place out of the world, a long name.
    expect(rejections(add('a', { icon: 'skull' }))).toEqual(['invalid']);
    expect(rejections(add('a', { colour: WAYPOINT_COLOURS }))).toEqual(['invalid']);
    expect(rejections(add('a', { x: 1e9 }))).toEqual(['invalid']);
    expect(rejections(add('a', { x: 1.5 }))).toEqual(['invalid']);
    expect(rejections(add('x'.repeat(40)))).toEqual(['invalid']);
    while (s.player.waypoints.length < MAX_WAYPOINTS) add('x');
    expect(rejections(add('one more'))).toEqual(['invalid']);
    s.send({ type: 'waypoint.remove', index: 0 });
    expect(s.player.waypoints[0]!.name).toBe('40, -12');
    expect(rejections(s.send({ type: 'waypoint.remove', index: 9 }))).toEqual(['invalid']);
    s.step(TICKS_PER_SECOND);
    const back = readPlayer(playerRecord('w', s.player), registry, { x: 0, y: 65, z: 0 })!;
    expect(back.waypoints).toEqual(s.player.waypoints);
    expect(back.explored).toEqual(s.player.explored);
    // A saved symbol or colour that is no more falls back to the first.
    const record = playerRecord('w', s.player);
    (record.waypoints as unknown as { icon: string; colour: number }[])[0]!.icon = 'skull';
    (record.waypoints as unknown as { icon: string; colour: number }[])[0]!.colour = 99;
    const read = readPlayer(record, registry, { x: 0, y: 65, z: 0 })!;
    expect(read.waypoints[0]).toMatchObject({ icon: 'flag', colour: 0 });
  });

  it('colours the map a pixel a block: loaded columns as they stand, others from the generation', () => {
    const s = playerTestSim({ seed: 'map', worldType: 'default' });
    s.step(TICKS_PER_SECOND);
    const sim = s.sim;
    const model = new MapModel(sim.ctx, sim.world, registry, packLayers());
    const view = model.view(s.player, BIG_MAP_RADIUS);
    expect(view.columns).toHaveLength(Object.keys(s.player.explored).length);
    for (const column of view.columns) expect(column.colours).toHaveLength(MAP_CELLS * MAP_CELLS);
    expect(view.player.x).toBe(s.player.body.x);
    expect([view.centreX, view.centreZ]).toEqual([
      Math.floor(s.player.body.x),
      Math.floor(s.player.body.z),
    ]);
    // A block placed on top shows its own colour (relief aside), at once.
    const b = s.player.body;
    const [x, z] = [Math.floor(b.x) + 3, Math.floor(b.z) + 3];
    const cx = Math.floor(x / MAP_CELLS);
    const cz = Math.floor(z / MAP_CELLS);
    const column = () =>
      model.view(s.player, BIG_MAP_RADIUS).columns.find((c) => c.cx === cx && c.cz === cz)!;
    const at = () => column().colours[x - cx * MAP_CELLS + (z - cz * MAP_CELLS) * MAP_CELLS]!;
    const glass = registry.defaultState('block:glowbloom_lantern');
    s.put(x, 120, z, 'block:glowbloom_lantern');
    expect(
      sim.world.getColumn(cx, cz)!.heightmap[(x - cx * MAP_CELLS) | ((z - cz * MAP_CELLS) << 5)],
    ).toBe(121);
    const shown = at();
    const own = model.colourOf(glass, 0);
    const near = (a: number, c: number) => Math.abs(((a >> 8) & 255) - ((c >> 8) & 255)) < 40;
    expect(near(shown, own)).toBe(true);
    // An unloaded column never seen: coloured from the generation, water under the sea.
    const far = model.view(s.player, 1, 4000, 4000);
    expect(far.columns).toEqual([]);
    s.player.explored['125,125'] = true;
    const generated = model.view(s.player, 1, 4000, 4000).columns;
    expect(generated).toHaveLength(1);
    expect(generated[0]!.colours.some((c) => c !== 0)).toBe(true);
  });
});
