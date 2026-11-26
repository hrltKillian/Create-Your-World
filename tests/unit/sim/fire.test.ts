import { describe, expect, it } from 'vitest';
import { ticksOf } from '../../../src/sim/clock.ts';
import { DROPS, spawnDrop } from '../../../src/sim/itemDrops.ts';
import { registry } from '../../helpers/registry.ts';
import { playerTestSim } from '../../helpers/simHarness.ts';

/*
 * Lava and fire on the player (plan v3 « M29 »): lava hurts and sets the player on fire; the fire
 * lasts `fire.minSeconds`–`maxSeconds` once out, hurts every tick it burns, and water puts it out.
 * Lava burns the items that fall in. Numbers from the pack's balance.
 */

const b = registry.pack.balance;
const LAVA = 'block:lava[level=0,falling=0]';
const WATER = 'block:fresh_water[level=0,falling=0]';

function standingIn(block: string) {
  const s = playerTestSim({ seed: 'fire' });
  s.send({ type: 'debug.god', on: false });
  s.fill(0, 64, 0, 0, 64, 0, 'block:stone');
  s.fill(0, 65, 0, 0, 65, 0, block);
  s.send({ type: 'debug.teleport', x: 0.5, y: 65, z: 0.5 });
  // No healing while the fire is measured (a fed player heals fast: plan v3 « M30 »).
  s.player.survival.saturation = 0;
  s.player.survival.hunger = b.health.regenHungerAt - 1;
  return s;
}

describe('lava and fire', () => {
  it('lava hurts fast and lights a fire of min–max seconds, which burns on once out', () => {
    const s = standingIn(LAVA);
    const health = s.player.survival.health;
    s.step(10);
    const s1 = s.player.survival;
    const lava = registry.pack.blocks.find((def) => def.key === 'block:lava')!.contact!
      .damagePerSec!;
    expect(health - s1.health).toBeGreaterThan(lava * (8 / 30));
    expect(s1.cause).toMatch(/lava|fire/);
    expect(s1.burnTicks).toBeGreaterThanOrEqual(ticksOf(b.fire.minSeconds) - 1);
    expect(s1.burnTicks).toBeLessThanOrEqual(ticksOf(b.fire.maxSeconds));
    // Out of the lava, onto stone: it burns on, then goes out by itself.
    s.fill(0, 65, 0, 0, 65, 0, 'block:air');
    const left = s1.burnTicks;
    const before = s1.health;
    s.step(left - 1);
    expect(s.player.survival.burnTicks).toBe(1);
    expect(before - s.player.survival.health).toBeCloseTo(
      (b.fire.damagePerSec * (left - 1)) / 30,
      5,
    );
    s.step(2);
    expect(s.player.survival.burnTicks).toBe(0);
    expect(s.player.survival.cause).toBe('fire');
  });

  it('water puts a fire out at once', () => {
    const s = standingIn(LAVA);
    s.step(5);
    expect(s.player.survival.burnTicks).toBeGreaterThan(0);
    s.fill(0, 65, 0, 0, 65, 0, WATER);
    s.step(1);
    expect(s.player.survival.burnTicks).toBe(0);
  });

  it('burns the items that fall into lava', () => {
    const s = standingIn('block:air');
    s.fill(3, 65, 0, 3, 65, 0, LAVA);
    const drop = spawnDrop(
      s.sim,
      { item: 'item:dirt', count: 3 },
      3.5,
      66,
      0.5,
      0,
      0,
      0,
      DROPS.thrownPickupDelayTicks,
    );
    s.step(30);
    expect(s.sim.entities.has(drop.id)).toBe(false);
  });
});
