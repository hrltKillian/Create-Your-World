import { describe, expect, it } from 'vitest';
import { ticksOf } from '../../../src/sim/clock.ts';
import type { SimEvent } from '../../../src/sim/events.ts';
import { FIRE, isFire, lightFire } from '../../../src/sim/fire.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim } from '../../helpers/simHarness.ts';

/*
 * Fire and lightning (plan v5 « M47 »), the reference game's rules, on the flat world (grass at
 * y 64, the player at (0.5, 65, 0.5)).
 */

const PLANKS = 'block:planks';
const LOG = registry.states[registry.defaultState('block:broadleaf_log')]!.key;
const STONE = 'block:stone';
const balance = registry.pack.balance;

function fireCells(
  s: ReturnType<typeof playerTestSim>,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
) {
  const cells: string[] = [];
  for (let y = y0; y <= y1; y++)
    for (let z = x0; z <= x1; z++)
      for (let x = x0; x <= x1; x++)
        if (isFire(registry, s.sim.world.getBlock(x, y, z))) cells.push(`${x},${y},${z}`);
  return cells;
}

/** A deck of planks at y 65–66 around (10, 10), a fire lit on top of its middle. */
function burningDeck(seed: string) {
  const s = playerTestSim({ seed });
  s.fill(6, 65, 6, 14, 66, 14, PLANKS);
  const out: SimEvent[] = [];
  expect(lightFire(s.sim, 10, 67, 10, 0, out)).toBe(true);
  return s;
}

describe('fire (plan v5 « M47 »)', () => {
  it('spreads over planks and burns some away, as the reference game does', () => {
    const s = burningDeck('fire-deck');
    s.step(ticksOf(40));
    const planks = registry.defaultState(PLANKS);
    let burnt = 0;
    for (let y = 65; y <= 66; y++)
      for (let z = 6; z <= 14; z++)
        for (let x = 6; x <= 14; x++) if (s.sim.world.getBlock(x, y, z) !== planks) burnt++;
    expect(burnt).toBeGreaterThan(3);
    expect(fireCells(s, 5, 15, 64, 72).length).toBeGreaterThan(1);
  });

  it('burns the same way from the same seed', () => {
    const runs = [burningDeck('fire-same'), burningDeck('fire-same')].map((s) => {
      s.step(ticksOf(20));
      return fireCells(s, 5, 15, 64, 72).join(' ');
    });
    expect(runs[0]).toBe(runs[1]);
  });

  it('goes out where nothing holds it, and on bare stone once past its first ages', () => {
    const s = playerTestSim({ seed: 'fire-out' });
    s.fill(4, 65, 4, 4, 65, 4, STONE);
    const out: SimEvent[] = [];
    // In the air: nothing to light.
    expect(lightFire(s.sim, 4, 70, 4, 0, out)).toBe(false);
    expect(lightFire(s.sim, 4, 66, 4, 0, out)).toBe(true);
    // Past age 3 (a third of its ticks age it): about 12 ticks, well within 40.
    s.step(ticksOf(FIRE.delay[1] * 40));
    expect(isFire(registry, s.sim.world.getBlock(4, 66, 4))).toBe(false);
  });

  it('is put out by the rain under the open sky, and spreads nowhere rained on', () => {
    const s = burningDeck('fire-rain');
    s.send({ type: 'debug.setWeather', weather: 'rain', seconds: 600 });
    s.step(ticksOf(60));
    expect(fireCells(s, 5, 15, 64, 72)).toEqual([]);
  });

  it('hurts nobody who stands clear of it, and burns a player who stands in it', () => {
    const s = playerTestSim({ seed: 'fire-touch' });
    s.fill(0, 64, -1, 0, 64, -1, LOG);
    const out: SimEvent[] = [];
    expect(lightFire(s.sim, 0, 65, 0, 0, out)).toBe(true);
    s.step(ticksOf(balance.climate.sampleSec) + 2);
    expect(s.player.survival.burnTicks).toBeGreaterThan(0);
    expect(s.player.survival.health).toBeLessThan(balance.health.max);
  });
});

describe('lightning (plan v5 « M47 »)', () => {
  it('strikes the top of a column, hurts and burns the player near it, lights a fire there', () => {
    const s = playerTestSim({ seed: 'strike' });
    s.fill(2, 65, 0, 2, 66, 0, LOG);
    const events = s.send({ type: 'debug.strike', x: 2, z: 0 });
    expect(eventsOf(events, 'lightning')).toEqual([{ type: 'lightning', x: 2, y: 67, z: 0 }]);
    expect(isFire(registry, s.sim.world.getBlock(2, 67, 0))).toBe(true);
    const survival = s.player.survival;
    // The strike's harm, and the first tick of the fire it lit on the player.
    const after = balance.health.max - balance.weather.lightningDamage;
    expect(survival.health).toBeLessThanOrEqual(after);
    expect(survival.health).toBeGreaterThan(after - 1);
    expect(survival.burnTicks).toBeGreaterThan(0);
  });

  it('leaves a player out of its reach unhurt', () => {
    const s = playerTestSim({ seed: 'strike-far' });
    s.send({ type: 'debug.strike', x: 12, z: 12 });
    expect(s.player.survival.health).toBe(balance.health.max);
    expect(s.player.survival.burnTicks).toBe(0);
  });

  it('kills with its own cause', () => {
    const s = playerTestSim({ seed: 'strike-kill' });
    s.send({ type: 'debug.setStat', stat: 'health', value: 10 });
    s.send({ type: 'debug.strike', x: 1, z: 0 });
    expect(s.player.survival.cause).toBe('lightning');
  });
});
