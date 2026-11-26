import { describe, expect, it } from 'vitest';
import { registry } from '../../helpers/registry.ts';
import { playerTestSim } from '../../helpers/simHarness.ts';

/*
 * Hunger as the reference game has it (plan v3 « M30 »), in the simulation: efforts add
 * exhaustion (sprinting, jumping), sprinting needs more than `sprintFrom` hunger, a food gives its
 * hidden saturation, never above the hunger it leaves. Numbers from the pack's balance.
 */

const b = registry.pack.balance;
const e = b.hunger.exhaustion;

describe('hunger in the simulation', () => {
  it('tires a sprint by the block and a jump by its own; walking costs nothing', () => {
    const s = playerTestSim({ seed: 'hunger-effort' });
    const survival = s.player.survival;
    survival.exhaustion = 0;
    s.tick(60, { forward: 1 });
    expect(survival.exhaustion).toBe(0);
    const z0 = s.player.body.z;
    s.tick(60, { forward: 1, sprint: true });
    const blocks = z0 - s.player.body.z;
    expect(blocks).toBeGreaterThan(8);
    expect(survival.exhaustion).toBeCloseTo(e.sprintPerBlock * blocks, 1);
    survival.exhaustion = 0;
    s.tick(1, { jump: true });
    s.tick(30);
    expect(survival.exhaustion).toBeCloseTo(e.jump, 9);
  });

  it('cannot sprint with sprintFrom hunger or less', () => {
    const s = playerTestSim({ seed: 'hunger-sprint' });
    s.player.survival.hunger = b.hunger.sprintFrom;
    s.player.survival.saturation = 0;
    s.tick(20, { forward: 1, sprint: true });
    expect(s.player.sprinting).toBe(false);
    s.player.survival.hunger = b.hunger.sprintFrom + 5;
    s.tick(20, { forward: 1, sprint: true });
    expect(s.player.sprinting).toBe(true);
  });

  it('gives a food’s saturation, never above the hunger it leaves', () => {
    const meat = registry.item('item:grilled_meat')!.consume!;
    const s = playerTestSim({ seed: 'hunger-meal' });
    s.give('item:grilled_meat', 1);
    const survival = s.player.survival;
    survival.hunger = 10;
    survival.saturation = 0;
    s.tick(Math.ceil(meat.seconds * 30) + 2, { secondary: true });
    expect(survival.hunger).toBe(10 + meat.hunger!);
    // The steak's saturation is more than the hunger it leaves: it stops at the hunger.
    expect(meat.saturation!).toBeGreaterThan(survival.hunger);
    expect(survival.saturation).toBe(survival.hunger);
  });
});
