import { describe, expect, it } from 'vitest';
import { synthesize } from '../../../src/assets/procedural/synth.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';
import type { SfxDef } from '../../../src/content/schema.ts';

const RATE = 22_050;
const rms = (def: SfxDef) => {
  const s = synthesize(def, RATE);
  let e = 0;
  for (const v of s) e += v * v;
  return Math.sqrt(e / s.length);
};
const recipes = basePack.sfx ?? [];
const voiced = new Set(
  (basePack.creatures ?? []).flatMap((c) => Object.values(c.sounds) as string[]),
);

describe('the levels of the soundscape (plan v4 « M45 »)', () => {
  it('keeps every one-shot audible and none overpowering', () => {
    for (const def of recipes.filter((d) => !d.loop)) {
      const level = rms(def);
      expect(level, def.key).toBeGreaterThan(0.01);
      expect(level, def.key).toBeLessThan(0.25);
    }
  });

  it('keeps the ambience loops a quiet bed', () => {
    for (const def of recipes.filter((d) => d.loop)) {
      const level = rms(def);
      expect(level, def.key).toBeGreaterThan(0.003);
      expect(level, def.key).toBeLessThan(0.08);
    }
  });

  it('balances the creatures: their voices within a factor of 6 of each other', () => {
    const levels = recipes.filter((d) => voiced.has(d.key)).map(rms);
    expect(levels.length).toBeGreaterThan(20);
    expect(Math.max(...levels) / Math.min(...levels)).toBeLessThan(6);
  });
});
