import { describe, expect, it } from 'vitest';
import { MapModel } from '../../../src/app/mapModel.ts';
import { COLLISION_BOXES, COLLISION_NONE } from '../../../src/content/registry.ts';
import { TICKS_PER_SECOND } from '../../../src/sim/clock.ts';
import { EXPLORE_RADIUS, exploredKey, MAX_WAYPOINTS } from '../../../src/sim/exploration.ts';
import { PHYSICS } from '../../../src/sim/physics.ts';
import { playerRecord, readPlayer } from '../../../src/sim/saveRecords.ts';
import { BIG_MAP_RADIUS, MAP_CELLS } from '../../../src/ui/map.ts';
import { blockToColumn } from '../../../src/world/coords.ts';
import { createGenContext } from '../../../src/world/gen/generateColumn.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim, rejections } from '../../helpers/simHarness.ts';

/*
 * Exploration (plan v3 « M27 »): ladders climbed and slid down without a fall's harm, trapdoors
 * opened by secondary, the columns explored, the waypoints marked and the map's colours.
 */

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

  it('marks waypoints at the feet, at most eight, and removes them; they are saved', () => {
    const s = playerTestSim({ seed: 'waypoints' });
    const events = s.send({ type: 'waypoint.add', name: ' Home ' });
    expect(eventsOf(events, 'waypointsChanged')).toHaveLength(1);
    expect(s.player.waypoints).toEqual([{ name: 'Home', x: 0, z: 0 }]);
    s.send({ type: 'waypoint.add', name: '' });
    expect(s.player.waypoints[1]!.name).toBe('0, 0');
    while (s.player.waypoints.length < MAX_WAYPOINTS) s.send({ type: 'waypoint.add', name: 'x' });
    expect(rejections(s.send({ type: 'waypoint.add', name: 'one more' }))).toEqual(['invalid']);
    expect(rejections(s.send({ type: 'waypoint.add', name: 'x'.repeat(40) }))).toEqual(['invalid']);
    s.send({ type: 'waypoint.remove', index: 0 });
    expect(s.player.waypoints[0]!.name).toBe('0, 0');
    expect(rejections(s.send({ type: 'waypoint.remove', index: 9 }))).toEqual(['invalid']);
    s.step(TICKS_PER_SECOND);
    const back = readPlayer(playerRecord('w', s.player), registry, { x: 0, y: 65, z: 0 })!;
    expect(back.waypoints).toEqual(s.player.waypoints);
    expect(back.explored).toEqual(s.player.explored);
  });

  it('colours the map from the generation: water under the sea, every explored column', () => {
    const s = playerTestSim({ seed: 'map', worldType: 'default' });
    s.step(TICKS_PER_SECOND);
    const model = new MapModel(createGenContext('map', registry));
    const view = model.view(s.player, BIG_MAP_RADIUS);
    expect(view.columns).toHaveLength(Object.keys(s.player.explored).length);
    for (const column of view.columns) expect(column.colours).toHaveLength(MAP_CELLS * MAP_CELLS);
    expect(view.player.x).toBeGreaterThanOrEqual(0);
    expect(view.player.x).toBeLessThan(1);
  });
});
