import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../../../src/sim/clock.ts';
import { STATION_REACH } from '../../../src/sim/craftQueue.ts';
import { conditionHolds } from '../../../src/sim/objectives.ts';
import { DAY_TICKS, HOUR_TICKS, nightsSurvived, START_HOUR } from '../../../src/sim/time.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim } from '../../helpers/simHarness.ts';

/*
 * The objectives chain (docs « Objectifs jusqu'au fer »): the steps and their conditions come from
 * the pack, never from copied keys.
 */

const chain = registry.pack.objectives!;
const objective = (match: (c: (typeof chain)[number]['condition']) => boolean) =>
  chain.find((o) => match(o.condition))!;
/** The first step: items only. */
const gather = chain[0]!;
const byStation = objective((c) => c.items === undefined && c.stations?.length === 1);
const night = objective((c) => c.nights === 1);
const shelter = objective((c) => c.enclosed === true);

/** Gives one of each item a step asks for; returns that tick's events. */
function giveItems(s: ReturnType<typeof playerTestSim>, step: (typeof chain)[number]) {
  return (step.condition.items ?? []).flatMap((item) => s.give(item));
}

/** Steps until the next objective check (once a second) has run; returns the events. */
function nextCheck(s: ReturnType<typeof playerTestSim>) {
  s.events.length = 0;
  s.step(TICKS_PER_SECOND);
  return eventsOf(s.events, 'objectiveDone');
}

describe('objectives', () => {
  it('counts the nights survived as the clock passes 06:00 after the first day', () => {
    expect(nightsSurvived(START_HOUR * HOUR_TICKS)).toBe(0);
    expect(nightsSurvived(DAY_TICKS + 6 * HOUR_TICKS - 1)).toBe(0);
    expect(nightsSurvived(DAY_TICKS + 6 * HOUR_TICKS)).toBe(1);
    expect(nightsSurvived(3 * DAY_TICKS)).toBe(2);
    expect(nightsSurvived(0)).toBe(0);
  });

  it('does a step once the player has had its items, checked once a second', () => {
    const s = playerTestSim({ seed: 'objectives-items' });
    expect(nextCheck(s)).toEqual([]);
    const items = gather.condition.items!;
    for (const item of items.slice(0, -1)) s.give(item);
    expect(nextCheck(s)).toEqual([]);
    s.give(items.at(-1)!);
    expect(s.sim.tick % TICKS_PER_SECOND).not.toBe(0);
    const done = nextCheck(s);
    expect(done).toEqual([{ type: 'objectiveDone', playerId: 1, objective: gather.key }]);
    expect(s.player.objectives).toEqual([gather.key]);
    // Items spent or dropped since do not undo it, and it is never done twice.
    s.player.inventory.fill(null);
    expect(nextCheck(s)).toEqual([]);
    expect(s.player.objectives).toEqual([gather.key]);
  });

  it('counts a step done ahead of the chain, in the order the steps were done', () => {
    const s = playerTestSim({ seed: 'objectives-ahead' });
    const second = chain[1]!;
    giveItems(s, second);
    nextCheck(s);
    expect(s.player.objectives).toEqual([second.key]);
    giveItems(s, gather);
    nextCheck(s);
    expect(s.player.objectives).toEqual([second.key, gather.key]);
  });

  it('needs a block of the station within crafting reach', () => {
    const s = playerTestSim({ seed: 'objectives-station' });
    const station = byStation.condition.stations![0]!;
    const block = registry.pack.blocks.find((b) => b.station === station)!;
    const state = registry.states[registry.defaultState(block.key)]!.key;
    s.fill(STATION_REACH + 3, 65, 0, STATION_REACH + 3, 65, 0, state);
    nextCheck(s);
    expect(s.player.objectives).not.toContain(byStation.key);
    s.fill(2, 65, 0, 2, 65, 0, state);
    nextCheck(s);
    expect(s.player.objectives).toContain(byStation.key);
  });

  it('reads the shelter and the nights survived at the time of the check', () => {
    const s = playerTestSim({ seed: 'objectives-night' });
    const { sim, player } = s;
    expect(conditionHolds(sim, player, night.condition)).toBe(false);
    sim.time.ticks = DAY_TICKS + 6 * HOUR_TICKS;
    expect(conditionHolds(sim, player, night.condition)).toBe(true);
    player.survival.shelter = 'covered';
    expect(conditionHolds(sim, player, { enclosed: true })).toBe(false);
    player.survival.shelter = 'enclosed';
    expect(conditionHolds(sim, player, { enclosed: true })).toBe(true);
    // The shelter step also wants its station near.
    expect(conditionHolds(sim, player, shelter.condition)).toBe(false);
  });

  it('checks nothing for a dead player', () => {
    const s = playerTestSim({ seed: 'objectives-dead' });
    giveItems(s, gather);
    s.player.survival.health = 0;
    s.player.survival.dead = true;
    expect(nextCheck(s)).toEqual([]);
    expect(s.player.objectives).toEqual([]);
  });
});
