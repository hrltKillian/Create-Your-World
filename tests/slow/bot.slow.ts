import { describe, expect, it } from 'vitest';
import { runBot } from '../../src/sim/testing/runBot.ts';
import { registry } from '../helpers/registry.ts';

/** Two in-game days (1 day = 36 000 ticks = 20 min). */
const TWO_DAYS = 72_000;

describe('long bot runs', () => {
  it('keeps identical hashes at every checkpoint over two game days', () => {
    const run = () => {
      const hashes: number[] = [];
      const result = runBot({
        registry,
        seed: 'slow-42',
        ticks: TWO_DAYS,
        bot: 'wander',
        everyTicks: 6000,
        onCheckpoint: (_tick, hash) => hashes.push(hash),
      });
      return { result, hashes };
    };
    const a = run();
    const b = run();
    expect(a.hashes).toHaveLength(TWO_DAYS / 6000);
    expect(b.hashes).toEqual(a.hashes);
    expect(b.result).toEqual(a.result);
    // Two days without drinking kill the bot: it must come back, not lie dead for the rest.
    expect(a.result.alive || a.result.respawns > 0).toBe(true);
    // Each death is followed by a respawn on the next tick.
    expect(a.result.respawns).toBe(a.result.deaths - (a.result.alive ? 0 : 1));
  });
});
