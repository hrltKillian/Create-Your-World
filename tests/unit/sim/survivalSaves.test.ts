import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../../src/sim/MemoryStorage.ts';
import { persistentHash } from '../../../src/sim/persistence.ts';
import { playerRecord, readPlayer } from '../../../src/sim/saveRecords.ts';
import { createSurvival } from '../../../src/sim/survival.ts';
import { registry } from '../../helpers/registry.ts';
import { restoreFrom, saveTo, settle } from '../../helpers/save.ts';
import { createTestSim } from '../../helpers/simHarness.ts';

const b = registry.pack.balance;

/**
 * A flat world whose player is mid-game: hurt, chilled, poisoned, in fur, with a grave,
 * immune to damage (debug).
 */
function midGame() {
  const s = createTestSim({ seed: 'survival-saves', worldType: 'flat', allowDebug: true });
  const player = s.sim.addPlayer(1, 2);
  s.step(40);
  const survival = player.survival;
  survival.health = 33.25;
  survival.temperature = -52;
  survival.toxicity = 41;
  survival.cause = 'cold';
  survival.god = true;
  player.equipment[2] = { item: 'item:fur_coat', count: 1, durability: 120 };
  player.respawn = { x: 4, y: 65, z: -3 };
  player.graves.push({ x: 10, y: 65, z: 10 }, { x: -20, y: 40, z: 7 });
  player.quests['quest:first'] = { progress: 2, done: true, claimed: false };
  player.pinned = 'quest:first';
  player.biomes['biome:tundra'] = true;
  player.xp = 420;
  player.skills.vitality = 2;
  player.survival.healthMax += 20;
  player.tasks[0] = { key: 'task:dig', progress: 9 };
  player.taskDraws = 4;
  player.rerollDay = 0;
  player.drank = true;
  s.step(45);
  return { ...s, player };
}

describe('survival saves', () => {
  it('round-trip the gauges, gear, bedroll, graves and quests, which run on alike', async () => {
    const straight = midGame();
    const first = midGame();
    const storage = new MemoryStorage();
    await saveTo(storage, first.sim);
    const resumed = await restoreFrom(storage);
    const player = resumed.sim.players.get(1)!;
    expect(playerRecord('w', player)).toEqual(playerRecord('w', first.player));
    expect(player.survival).toEqual(first.player.survival);
    expect(player.drank).toBe(true);
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
        effects: [{ key: 'untargeted', ticks: 3 }],
      },
      equipment: [{ item: 'item:fur_hood', count: 1 }, { item: 4 }, null, null, null, 'x'],
      respawn: { x: 1.5, y: 2, z: 3 },
      graves: [{ x: 1, y: 2, z: 3 }, { x: 1, y: -2, z: 3 }, 'grave'],
      quests: {
        'quest:a': { progress: 1, done: false, claimed: false },
        'quest:b': { progress: -1, done: true, claimed: false },
        'quest:c': { progress: 0, done: false, claimed: true },
        'quest:d': 'done',
      },
      pinned: 7,
      biomes: ['biome:tundra', 3],
    };
    const player = readPlayer(saved, registry, spawn)!;
    // Fields of older saves (effects, shelter) are not read.
    expect(player.survival).toEqual({ ...createSurvival(b), hunger: 12 });
    expect(player.equipment).toEqual([{ item: 'item:fur_hood', count: 1 }, null, null, null, null]);
    expect(player.respawn).toBeNull();
    expect(player.graves).toEqual([{ x: 1, y: 2, z: 3 }]);
    // A claim without the quest done is read as not claimed.
    expect(player.quests).toEqual({
      'quest:a': { progress: 1, done: false, claimed: false },
      'quest:c': { progress: 0, done: false, claimed: false },
    });
    expect(player.pinned).toBeNull();
    expect(player.biomes).toEqual({ 'biome:tundra': true });
    const bare = readPlayer({ playerId: 1, id: 1 }, registry, spawn)!;
    expect(bare.survival).toEqual(createSurvival(b));
    expect(bare).toMatchObject({
      respawn: null,
      graves: [],
      quests: {},
      pinned: null,
      drank: false,
    });
  });

  it('copy a field only onto one of its own type, and keep the gauges within their ranges', () => {
    const spawn = { x: 1, y: 2, z: 3 };
    const survival = {
      // Numbers where text belongs, text and lists where numbers and flags belong.
      cause: 5,
      dead: 1,
      god: 'yes',
      calmTicks: [4],
      // Gauges out of their ranges.
      health: 500,
      hunger: -20,
      thirst: Number.POSITIVE_INFINITY,
      temperature: -1000,
      toxicity: 250,
      breath: -3,
    };
    const player = readPlayer({ playerId: 1, id: 1, survival, drank: 'yes' }, registry, spawn)!;
    const fresh = createSurvival(b);
    expect(player.survival).toEqual({
      ...fresh,
      health: b.health.max,
      hunger: 0,
      temperature: -b.temperature.limit,
      toxicity: b.toxicity.max,
      breath: 0,
    });
    expect(player.drank).toBe(false);
  });
});
