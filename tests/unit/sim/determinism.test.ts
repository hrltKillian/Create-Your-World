import { describe, expect, it } from 'vitest';
import { stateHash } from '../../../src/sim/stateHash.ts';
import { runBot } from '../../../src/sim/testing/runBot.ts';
import { registry } from '../../helpers/registry.ts';
import { createTestSim } from '../../helpers/simHarness.ts';

/** Mines, places, throws and picks up items in the arena; returns the final state hash. */
function interactionRun(serialize: boolean): number {
  const s = createTestSim({ seed: 'det-i', worldType: 'arena', allowDebug: true, serialize });
  s.sim.addPlayer(1, 2);
  s.step(60);
  s.host.send({ type: 'debug.give', item: 'item:flint_pickaxe', count: 1 });
  s.host.send({ type: 'debug.give', item: 'item:planks', count: 20 });
  s.tick(40, { secondary: true, slot: 1, pitch: -0.8, yaw: 1 });
  s.host.send({ type: 'inv.drop', slot: 1, all: false });
  s.tick(120, { primary: true, pitch: -1.5 });
  s.tick(60, { forward: 1, jump: true, yaw: 2.4, primary: true, pitch: -0.3 });
  s.tick(30, { strafe: 1, secondary: true, slot: 1, pitch: -0.9 });
  const types = new Set(s.events.map((e) => e.type));
  for (const type of ['blockBroken', 'blockPlaced', 'itemPickedUp', 'mineProgress'] as const)
    expect(types.has(type), type).toBe(true);
  return stateHash(s.sim);
}

/** Crafts, fills a chest, runs a kiln, walks away and back; returns the final state hash. */
function workshopRun(serialize: boolean): number {
  const s = createTestSim({ seed: 'det-w', worldType: 'flat', allowDebug: true, serialize });
  s.sim.addPlayer(1, 2);
  s.step(60);
  const fill = (x: number, z: number, state: string) =>
    s.host.send({ type: 'debug.fill', x0: x, y0: 65, z0: z, x1: x, y1: 65, z1: z, state });
  fill(2, -2, 'block:kiln[facing4=s,lit=0]');
  fill(-2, -2, 'block:chest[facing4=s]');
  for (const [item, count] of [
    ['item:copper_ore', 4],
    ['item:stick', 9],
    ['item:flint', 2],
    ['item:cord', 1],
  ] as const)
    s.host.send({ type: 'debug.give', item, count });
  s.step(1);
  s.host.send({ type: 'container.open', x: 2, y: 65, z: -2 });
  s.host.send({ type: 'station.move', from: 0 });
  s.host.send({ type: 'station.move', from: 1, to: 34, count: 4 });
  s.host.send({ type: 'craft.enqueue', recipe: 'recipe:flint_hatchet', count: 1 });
  s.step(200);
  s.host.send({ type: 'container.open', x: -2, y: 65, z: -2 });
  s.host.send({ type: 'container.move', from: 2 });
  s.host.send({ type: 'debug.teleport', x: 20 * 32, y: 'surface', z: 0.5 });
  s.step(400);
  s.host.send({ type: 'debug.teleport', x: 0.5, y: 65, z: 0.5 });
  s.step(600);
  const types = new Set(s.events.map((e) => e.type));
  for (const type of ['crafted', 'blockEntityOpened', 'blockEntityClosed'] as const)
    expect(types.has(type), type).toBe(true);
  return stateHash(s.sim);
}

describe('simulation determinism', () => {
  it('gives the same hash on two runs of the wander bot', () => {
    const a = runBot({ registry, seed: 'det-a', ticks: 900, bot: 'wander' });
    const b = runBot({ registry, seed: 'det-a', ticks: 900, bot: 'wander' });
    expect(a.ticks).toBe(900);
    expect(a.hash).toBe(b.hash);
    // The bot actually went somewhere (the player was not frozen).
    expect(Math.hypot(a.x - 0, a.z - 0)).toBeGreaterThan(0);
    expect(a.columns).toBeGreaterThan(9);
  });

  it('gives the same hash through the serializing host (JSON commands and events)', () => {
    const local = runBot({ registry, seed: 'det-b', ticks: 600, bot: 'wander' });
    const json = runBot({ registry, seed: 'det-b', ticks: 600, bot: 'wander', serialize: true });
    expect(json.hash).toBe(local.hash);
  });

  it('gives the same hash on two runs of the wanderMineBuild bot, also through JSON', () => {
    const run = (serialize: boolean) =>
      runBot({ registry, seed: 'det-m', ticks: 1500, bot: 'wanderMineBuild', serialize });
    const a = run(false);
    expect(run(false)).toEqual(a);
    expect(run(true).hash).toBe(a.hash);
    // On the way it mined, built and picked up what it mined.
    expect(a.broken).toBeGreaterThan(0);
    expect(a.placed).toBeGreaterThan(0);
    expect(a.pickedUp).toBeGreaterThan(0);
  });

  it('gives the same hash for mining, placing and item drops, also through JSON', () => {
    const a = interactionRun(false);
    expect(interactionRun(false)).toBe(a);
    expect(interactionRun(true)).toBe(a);
  });

  it('gives the same hash for crafting, chests and stations, also through JSON', () => {
    const a = workshopRun(false);
    expect(workshopRun(false)).toBe(a);
    expect(workshopRun(true)).toBe(a);
  });

  it('gives different hashes for different seeds', () => {
    const a = runBot({ registry, seed: 'det-c', ticks: 300, bot: 'wander' });
    const b = runBot({ registry, seed: 'det-d', ticks: 300, bot: 'wander' });
    expect(a.hash).not.toBe(b.hash);
  });

  it('moves the bot across a flat world', () => {
    const first = runBot({ registry, seed: 'det-e', ticks: 30, bot: 'wander', worldType: 'flat' });
    const later = runBot({ registry, seed: 'det-e', ticks: 600, bot: 'wander', worldType: 'flat' });
    expect(later.y).toBeCloseTo(65, 2);
    expect(Math.hypot(later.x - first.x, later.z - first.z)).toBeGreaterThan(5);
  });
});
