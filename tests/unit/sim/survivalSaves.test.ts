import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../../src/sim/MemoryStorage.ts';
import { persistentHash } from '../../../src/sim/persistence.ts';
import { playerRecord, readPlayer } from '../../../src/sim/saveRecords.ts';
import { createSurvival } from '../../../src/sim/survival.ts';
import { registry } from '../../helpers/registry.ts';
import { restoreFrom, saveTo, settle } from '../../helpers/save.ts';
import { createTestSim } from '../../helpers/simHarness.ts';

const b = registry.pack.balance;

/** A flat world whose player is mid-game: hurt, chilled, poisoned, weakened, in fur, with a grave. */
function midGame() {
  const s = createTestSim({ seed: 'survival-saves', worldType: 'flat', allowDebug: true });
  const player = s.sim.addPlayer(1, 2);
  s.step(40);
  const survival = player.survival;
  survival.health = 33.25;
  survival.temperature = -52;
  survival.toxicity = 41;
  survival.cause = 'cold';
  survival.effects.push({ key: 'weakened', ticks: 900 }, { key: 'untargeted', ticks: 40 });
  player.equipment[2] = { item: 'item:fur_coat', count: 1, durability: 120 };
  player.respawn = { x: 4, y: 65, z: -3 };
  player.graves.push({ x: 10, y: 65, z: 10 }, { x: -20, y: 40, z: 7 });
  player.objectives.push('objective:first');
  s.step(45);
  return { ...s, player };
}

describe('survival saves', () => {
  it('round-trip the gauges, effects, gear, bedroll, graves and objectives, which run on alike', async () => {
    const straight = midGame();
    const first = midGame();
    const storage = new MemoryStorage();
    await saveTo(storage, first.sim);
    const resumed = await restoreFrom(storage);
    const player = resumed.sim.players.get(1)!;
    expect(playerRecord('w', player)).toEqual(playerRecord('w', first.player));
    expect(player.survival).toEqual(first.player.survival);
    expect(persistentHash(resumed.sim)).toBe(persistentHash(first.sim));
    settle(resumed.sim);
    straight.step(200);
    resumed.step(200);
    expect(player.survival).toEqual(straight.player.survival);
    expect(persistentHash(resumed.sim)).toBe(persistentHash(straight.sim));
  });

  it('read malformed survival fields as defaults', () => {
    const spawn = { x: 1, y: 2, z: 3 };
    const saved = {
      playerId: 1,
      id: 1,
      survival: {
        health: 'lots',
        hunger: 12,
        shelter: 'castle',
        cause: 'boredom',
        effects: [
          { key: 'weakened', ticks: 0 },
          { key: 'cursed', ticks: 9 },
          null,
          { key: 'untargeted', ticks: 3 },
        ],
      },
      equipment: [{ item: 'item:fur_hood', count: 1 }, { item: 4 }, null, null, null, 'x'],
      respawn: { x: 1.5, y: 2, z: 3 },
      graves: [{ x: 1, y: 2, z: 3 }, { x: 1, y: -2, z: 3 }, 'grave'],
      objectives: ['objective:a', 7],
    };
    const player = readPlayer(saved, registry, spawn)!;
    expect(player.survival).toEqual({
      ...createSurvival(b),
      hunger: 12,
      effects: [{ key: 'untargeted', ticks: 3 }],
    });
    expect(player.equipment).toEqual([{ item: 'item:fur_hood', count: 1 }, null, null, null, null]);
    expect(player.respawn).toBeNull();
    expect(player.graves).toEqual([{ x: 1, y: 2, z: 3 }]);
    expect(player.objectives).toEqual(['objective:a']);
    const bare = readPlayer({ playerId: 1, id: 1 }, registry, spawn)!;
    expect(bare.survival).toEqual(createSurvival(b));
    expect(bare).toMatchObject({ respawn: null, graves: [], objectives: [] });
  });
});
