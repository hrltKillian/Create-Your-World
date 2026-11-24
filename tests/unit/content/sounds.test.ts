import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import type { ContentPack } from '../../../src/content/schema.ts';
import { validatePack } from '../../../src/content/validate.ts';
import { MAX_SFX_SECONDS, sfxSeconds } from '../../../src/content/validateSounds.ts';

describe('sound recipes', () => {
  it('has one recipe for every bound sound, combat blow and creature voice', () => {
    const recipes = new Set(basePack.sfx!.map((def) => def.key));
    const sounds = basePack.sounds!;
    const bound = [
      sounds.pickup,
      sounds.click,
      sounds.combat.hit,
      sounds.combat.hurt,
      ...Object.values(sounds.blocks).flatMap((m) => [m.break, m.hit, m.place]),
      ...basePack.creatures!.flatMap((c) => Object.values(c.sounds)),
    ];
    for (const key of bound) expect(recipes.has(key), key).toBe(true);
    expect(recipes.size).toBe(bound.length);
    for (const def of basePack.sfx!) expect(sfxSeconds(def)).toBeLessThanOrEqual(MAX_SFX_SECONDS);
  });

  it('reports missing recipes and bad layers with exact paths', () => {
    const pack = JSON.parse(JSON.stringify(basePack)) as {
      sfx: { key: string; layers: Record<string, unknown>[] }[];
    };
    pack.sfx = pack.sfx.filter((def) => def.key !== 'sfx:pickup');
    const layers = pack.sfx[0]!.layers;
    layers[0]!.gain = 0;
    layers.push({ source: 'sine', gain: 0.5, attack: 0.01, decay: 0.1 });
    layers.push({ source: 'noise', gain: 0.5, attack: 0.01, decay: 5 });
    const paths = validatePack(pack as unknown as ContentPack).map((i) => i.path);
    const n = layers.length;
    expect(paths).toContain('sounds.pickup');
    expect(paths).toContain('sfx[0].layers[0].gain');
    expect(paths).toContain(`sfx[0].layers[${n - 2}].freq`);
    expect(paths).toContain(`sfx[0].layers[${n - 1}].decay`);
  });
});
