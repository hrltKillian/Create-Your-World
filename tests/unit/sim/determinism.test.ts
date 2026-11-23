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

  it('gives the same hash for mining, placing and item drops, also through JSON', () => {
    const a = interactionRun(false);
    expect(interactionRun(false)).toBe(a);
    expect(interactionRun(true)).toBe(a);
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
