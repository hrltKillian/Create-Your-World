import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import type { ContentPack, SfxDef } from '../../../src/content/schema.ts';
import { validatePack } from '../../../src/content/validate.ts';
import {
  boundSounds,
  MAX_LOOP_SECONDS,
  MAX_SFX_SECONDS,
  sfxSeconds,
} from '../../../src/content/validateSounds.ts';

const sounds = basePack.sounds!;
const recipes = new Map<string, SfxDef>(basePack.sfx!.map((def) => [def.key, def]));

/** A deep copy of the base pack to break. */
const copy = () =>
  JSON.parse(JSON.stringify(basePack)) as {
    sfx: { key: string; loop?: boolean; layers: Record<string, unknown>[] }[];
    sounds: { player: { jump: string }; ambience: { cave: string }; lit: Record<string, string> };
  };
const issuePaths = (pack: unknown) => validatePack(pack as ContentPack).map((issue) => issue.path);

describe('sound recipes', () => {
  it('has one recipe for every bound sound and creature voice, and none unused', () => {
    const bound = [
      ...boundSounds(sounds).map(([, key]) => key),
      ...basePack.creatures!.flatMap((c) => Object.values(c.sounds)),
    ];
    for (const key of bound) expect(recipes.has(key), key).toBe(true);
    expect(new Set(bound)).toEqual(new Set(recipes.keys()));
  });

  it('binds about 45 sounds (docs « Audio »): every material, player, place and stinger', () => {
    const paths = boundSounds(sounds).map(([path]) => path);
    for (const material of Object.keys(sounds.blocks))
      for (const action of ['break', 'hit', 'place', 'step'])
        expect(paths).toContain(`sounds.blocks.${material}.${action}`);
    for (const path of ['player.jump', 'player.heartbeat', 'door.open', 'chest.close', 'craft'])
      expect(paths).toContain(`sounds.${path}`);
    expect(new Set(boundSounds(sounds).map(([, key]) => key)).size).toBeGreaterThanOrEqual(45);
  });

  it('keeps one-shots short and ambience loops looped and within their own limit', () => {
    const loops = new Set(
      boundSounds(sounds)
        .filter(([path]) => path.startsWith('sounds.ambience.'))
        .map(([, key]) => key),
    );
    expect(loops.size).toBeGreaterThanOrEqual(5);
    for (const def of basePack.sfx!) {
      expect(def.loop === true, def.key).toBe(loops.has(def.key));
      const limit = def.loop ? MAX_LOOP_SECONDS : MAX_SFX_SECONDS;
      expect(sfxSeconds(def), def.key).toBeLessThanOrEqual(limit);
    }
  });

  it('counts a held peak in the length of a recipe', () => {
    const layer = {
      source: 'noise',
      gain: 0.5,
      attack: 0.1,
      hold: 2,
      decay: 0.4,
      delay: 1,
    } as const;
    expect(sfxSeconds({ key: 'sfx:x', layers: [layer] })).toBeCloseTo(3.5);
  });

  it('reports missing recipes and bad layers with exact paths', () => {
    const pack = copy();
    pack.sfx = pack.sfx.filter((def) => def.key !== 'sfx:pickup');
    const layers = pack.sfx[0]!.layers;
    layers[0]!.gain = 0;
    layers.push({ source: 'sine', gain: 0.5, attack: 0.01, decay: 0.1 });
    layers.push({ source: 'noise', gain: 0.5, attack: 0.01, decay: 5 });
    const paths = issuePaths(pack);
    const n = layers.length;
    expect(paths).toContain('sounds.pickup');
    expect(paths).toContain('sfx[0].layers[0].gain');
    expect(paths).toContain(`sfx[0].layers[${n - 2}].freq`);
    expect(paths).toContain(`sfx[0].layers[${n - 1}].decay`);
  });

  it('wants loops for the ambience only, and known stations and biomes', () => {
    const pack = copy();
    pack.sounds.player.jump = pack.sounds.ambience.cave;
    pack.sounds.lit['station:nowhere'] = 'sfx:fire';
    const paths = issuePaths(pack);
    expect(paths).toContain('sounds.player.jump');
    expect(paths).toContain('sounds.lit.station:nowhere');
    const cave = pack.sfx.find((def) => def.key === pack.sounds.ambience.cave)!;
    cave.loop = false;
    expect(issuePaths(pack)).toContain('sounds.ambience.cave');
  });
});
