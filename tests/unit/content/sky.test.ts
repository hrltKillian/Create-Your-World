import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import type { ContentPack, SkyDef } from '../../../src/content/schema.ts';
import { validatePack } from '../../../src/content/validate.ts';

const sky = basePack.sky!;
const issues = (pack: ContentPack) => validatePack(pack).map((issue) => issue.path);

describe('the sky of a pack (plan v4 « M39 »)', () => {
  it('validates the base pack sky, with two moons and a giant', () => {
    expect(issues(basePack).filter((path) => path.startsWith('sky'))).toEqual([]);
    expect(sky.moons).toHaveLength(2);
    expect(sky.giant).toBeDefined();
    expect(basePack.biomes!.some((biome) => (biome.aurora ?? 0) > 0)).toBe(true);
  });

  it('refuses keys out of order, bad colours, moons out of range', () => {
    const bad: SkyDef = {
      ...sky,
      keys: [sky.keys[1]!, sky.keys[0]!, { ...sky.keys[2]!, zenith: 'blue' }],
      moons: [{ ...sky.moons[0]!, period: 0 }, sky.moons[1]!, sky.moons[0]!],
      aurora: ['#00ff00', '#zzzzzz'],
    };
    const found = issues({ ...basePack, sky: bad });
    expect(found).toContain('sky.keys[1].hour');
    expect(found).toContain('sky.keys[2].zenith');
    expect(found).toContain('sky.moons');
    expect(found).toContain('sky.moons[0].period');
    expect(found).toContain('sky.aurora[1]');
  });

  it("refuses a biome's aurora out of 0…1", () => {
    const biomes = basePack.biomes!.map((biome, i) => (i === 0 ? { ...biome, aurora: 2 } : biome));
    expect(issues({ ...basePack, biomes })).toContain('biomes[0].aurora');
  });
});
