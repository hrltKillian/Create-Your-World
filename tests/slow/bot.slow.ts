import { describe, expect, it } from 'vitest';
import type { BotKind } from '../../src/sim/testing/bots.ts';
import { type BotRunResult, runBot } from '../../src/sim/testing/runBot.ts';
import { registry } from '../helpers/registry.ts';

/** Two in-game days (1 day = 36 000 ticks = 20 min). */
const TWO_DAYS = 72_000;

/**
 * Runs a bot twice for two game days; expects the same hash at every checkpoint and the same end,
 * each death followed by a respawn on the next tick. Returns the first run's end.
 */
function sameTwice(bot: BotKind): BotRunResult {
  const run = () => {
    const hashes: number[] = [];
    const result = runBot({
      registry,
      seed: 'slow-42',
      ticks: TWO_DAYS,
      bot,
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
  expect(a.result.respawns).toBe(a.result.deaths - (a.result.alive ? 0 : 1));
  return a.result;
}

describe('long bot runs', () => {
  it('keeps identical hashes at every checkpoint over two game days (wander)', () => {
    const result = sameTwice('wander');
    // Two days without drinking kill the bot: it must come back, not lie dead for the rest.
    expect(result.alive || result.respawns > 0).toBe(true);
  });

  it('keeps identical hashes over two game days of mining, building and meals (wanderMineBuild)', () => {
    const result = sameTwice('wanderMineBuild');
    expect(result.broken).toBeGreaterThan(100);
    expect(result.placed).toBeGreaterThan(50);
    expect(result.pickedUp).toBeGreaterThan(50);
    expect(result.consumed).toBeGreaterThan(0);
  });
});
