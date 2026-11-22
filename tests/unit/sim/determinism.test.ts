import { describe, expect, it } from 'vitest';
import { runBot } from '../../../src/sim/testing/runBot.ts';
import { registry } from '../../helpers/registry.ts';

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
