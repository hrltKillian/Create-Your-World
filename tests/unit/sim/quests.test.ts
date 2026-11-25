import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../../../src/sim/clock.ts';
import type { CreatureState } from '../../../src/sim/creatures.ts';
import { eyeHeight } from '../../../src/sim/physics.ts';
import { conditionHolds, STATION_REACH } from '../../../src/sim/quests.ts';
import { DAY_TICKS, HOUR_TICKS } from '../../../src/sim/time.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim, rejections } from '../../helpers/simHarness.ts';

/*
 * The quest graph (plan v3 « M21 »): a quest exists once the quests it requires are done; a state
 * already reached does it at its unlock, a counter counts from the unlock on; parallel branches
 * open at the start; rewards are claimed once; one quest may be pinned.
 */

const quests = registry.pack.quests!;
const quest = (id: string) => quests.find((q) => q.key === `quest:${id}`)!;
type Harness = ReturnType<typeof playerTestSim>;

/** Steps until the next quest check (once a second) has run; returns the quest events. */
function nextCheck(s: Harness) {
  s.events.length = 0;
  s.step(TICKS_PER_SECOND);
  return s.events.filter((e) => e.type.startsWith('quest'));
}

const state = (s: Harness, id: string) => s.player.quests[`quest:${id}`];

describe('quests', () => {
  it('opens every branch without requirements at the first check, and only those', () => {
    const s = playerTestSim({ seed: 'quests-start' });
    s.player.quests = {};
    const unlocked = eventsOf(nextCheck(s), 'questUnlocked').map((e) => e.quest);
    const open = Object.keys(s.player.quests).sort();
    const starts = quests.filter((q) => !q.requires).map((q) => q.key);
    expect(starts.length).toBeGreaterThanOrEqual(3);
    expect(open).toEqual([...starts].sort());
    expect(unlocked).toEqual(starts);
  });

  it('does not count a state reached before the unlock, then does the quest as it unlocks', () => {
    const s = playerTestSim({ seed: 'quests-ahead' });
    for (const item of quest('tools').condition!.items!) s.give(item);
    nextCheck(s);
    expect(state(s, 'tools')).toBeUndefined();
    for (const item of quest('gather').condition!.items!) s.give(item);
    const events = nextCheck(s);
    // One pass: gather done, tools unlocked then done at once, said to be already done.
    expect(events).toEqual([
      { type: 'questDone', playerId: 1, quest: 'quest:gather', already: false },
      { type: 'questUnlocked', playerId: 1, quest: 'quest:tools' },
      { type: 'questDone', playerId: 1, quest: 'quest:tools', already: true },
      { type: 'questUnlocked', playerId: 1, quest: 'quest:harvest' },
      { type: 'questUnlocked', playerId: 1, quest: 'quest:workbench' },
    ]);
    // Items spent since undo nothing, and nothing is done twice.
    s.player.inventory.fill(null);
    expect(eventsOf(nextCheck(s), 'questDone')).toEqual([]);
    expect(state(s, 'gather')).toEqual({ progress: 0, done: true, claimed: false });
  });

  it('needs a block of the station within crafting reach', () => {
    const s = playerTestSim({ seed: 'quests-station' });
    const station = quest('workbench').condition!.stations![0]!;
    const block = registry.pack.blocks.find((b) => b.station === station)!;
    const key = registry.states[registry.defaultState(block.key)]!.key;
    expect(conditionHolds(s.sim, s.player, { stations: [station] })).toBe(false);
    s.fill(STATION_REACH + 3, 65, 0, STATION_REACH + 3, 65, 0, key);
    expect(conditionHolds(s.sim, s.player, { stations: [station] })).toBe(false);
    s.fill(2, 65, 0, 2, 65, 0, key);
    expect(conditionHolds(s.sim, s.player, { stations: [station] })).toBe(true);
  });

  it('counts a kill of the player’s, not one by command', () => {
    const s = playerTestSim({ seed: 'quests-hunt' });
    const hunt = quest('hunt');
    nextCheck(s);
    expect(state(s, 'hunt')).toEqual({ progress: 0, done: false, claimed: false });
    const place = () => {
      const id = s.sim.nextEntityId;
      const at = { x: 0.5, y: 'surface' as const, z: -1.5 };
      expect(
        rejections(s.send({ type: 'debug.spawn', creature: hunt.counter!.target!, ...at })),
      ).toEqual([]);
      const c = s.sim.entities.get(id) as CreatureState;
      Object.assign(c, { modeTicks: 600, health: 0.5 });
      return c;
    };
    s.send({ type: 'debug.killCreature', id: place().id });
    s.step(1);
    expect(state(s, 'hunt')!.progress).toBe(0);
    const c = place();
    const b = s.player.body;
    const def = registry.creature(c.creature)!;
    const dy = c.body.y + def.hitbox[1] / 2 - (b.y + eyeHeight(b));
    const pitch = Math.atan2(dy, Math.hypot(c.body.x - b.x, c.body.z - b.z));
    s.events.length = 0;
    s.tick(1, { primary: true, pitch });
    s.tick(1, { pitch });
    expect(eventsOf(s.events, 'questProgress')).toEqual([
      { type: 'questProgress', playerId: 1, quest: hunt.key, progress: 1 },
    ]);
    expect(eventsOf(s.events, 'questDone')).toEqual([
      { type: 'questDone', playerId: 1, quest: hunt.key, already: false },
    ]);
  });

  it('counts a night survived only once its quest is open', () => {
    const s = playerTestSim({ seed: 'quests-night' });
    const night = quest('night');
    const nights = () => {
      s.sim.time.ticks = Math.ceil(s.sim.time.ticks / DAY_TICKS) * DAY_TICKS + 5 * HOUR_TICKS;
      s.step(2 * HOUR_TICKS);
    };
    nights();
    expect(state(s, 'night')).toBeUndefined();
    for (const key of night.requires!)
      s.player.quests[key] = { progress: 0, done: true, claimed: false };
    nextCheck(s);
    expect(state(s, 'night')).toEqual({ progress: 0, done: false, claimed: false });
    nights();
    expect(state(s, 'night')).toEqual({ progress: 1, done: true, claimed: false });
  });

  it('gives the rewards once on a claim, and pins only an open quest', () => {
    const s = playerTestSim({ seed: 'quests-claim' });
    const gather = quest('gather');
    nextCheck(s);
    expect(rejections(s.send({ type: 'quest.claim', quest: gather.key }))).toHaveLength(1);
    expect(rejections(s.send({ type: 'quest.pin', quest: gather.key }))).toEqual([]);
    expect(s.player.pinned).toBe(gather.key);
    for (const item of gather.condition!.items!) s.give(item);
    nextCheck(s);
    const reward = gather.rewards![0]!;
    const before = s.player.inventory.reduce(
      (n, stack) => n + (stack?.item === reward.item ? stack.count : 0),
      0,
    );
    const events = s.send({ type: 'quest.claim', quest: gather.key });
    expect(eventsOf(events, 'questClaimed')).toEqual([
      { type: 'questClaimed', playerId: 1, quest: gather.key },
    ]);
    const after = s.player.inventory.reduce(
      (n, stack) => n + (stack?.item === reward.item ? stack.count : 0),
      0,
    );
    expect(after - before).toBe(reward.count);
    // Claimed: unpinned, never claimed twice, never pinned again; a locked quest is never pinned.
    expect(s.player.pinned).toBeNull();
    expect(rejections(s.send({ type: 'quest.claim', quest: gather.key }))).toHaveLength(1);
    expect(rejections(s.send({ type: 'quest.pin', quest: gather.key }))).toHaveLength(1);
    expect(rejections(s.send({ type: 'quest.pin', quest: 'quest:iron' }))).toHaveLength(1);
    expect(rejections(s.send({ type: 'quest.pin', quest: null }))).toEqual([]);
  });

  it('walks biomes and meets creatures for the conditions that ask for them', () => {
    const s = playerTestSim({ seed: 'quests-walk' });
    const { sim, player } = s;
    player.biomes = {};
    expect(conditionHolds(sim, player, { biomes: 1 })).toBe(false);
    nextCheck(s);
    expect(conditionHolds(sim, player, { biomes: 1 })).toBe(true);
    expect(conditionHolds(sim, player, { biomes: 2 })).toBe(false);
    expect(conditionHolds(sim, player, { met: 1 })).toBe(false);
    player.bestiary['creature:trotter'] = 1;
    expect(conditionHolds(sim, player, { met: 1 })).toBe(true);
  });

  it('checks nothing for a dead player', () => {
    const s = playerTestSim({ seed: 'quests-dead' });
    s.player.survival.health = 0;
    s.player.survival.dead = true;
    s.player.quests = {};
    expect(nextCheck(s)).toEqual([]);
    expect(s.player.quests).toEqual({});
  });
});
