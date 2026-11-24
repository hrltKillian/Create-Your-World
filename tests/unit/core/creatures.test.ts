import { describe, expect, it } from 'vitest';
import { CREATURE_EYE_SHARE, centreY, feetCell } from '../../../src/core/creatures.ts';
import { type CreatureState, eyeY } from '../../../src/sim/creatures.ts';
import { registry } from '../../helpers/registry.ts';

/* The creature body geometry shared by the simulation and the renderer (one copy of each rule). */

describe('creature body geometry', () => {
  it('puts the eyes at the shared share of the hitbox and the middle at half of it', () => {
    const def = registry.creature('creature:shagback')!;
    const c = { body: { x: 0, y: 64, z: 0 } } as CreatureState;
    expect(eyeY(c, def)).toBe(64 + def.hitbox[1] * CREATURE_EYE_SHARE);
    expect(centreY(64, def.hitbox[1])).toBe(64 + def.hitbox[1] / 2);
  });

  it('stands a body resting a hair under a top face in the cell above it', () => {
    expect(feetCell(65)).toBe(65);
    expect(feetCell(64.995)).toBe(65);
    expect(feetCell(65.98)).toBe(65);
    expect(feetCell(64.9)).toBe(64);
  });
});
