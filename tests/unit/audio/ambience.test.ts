import { describe, expect, it } from 'vitest';
import {
  AMBIENCE,
  Ambience,
  type AmbiencePlace,
  ambienceKey,
} from '../../../src/audio/Ambience.ts';
import { seamless } from '../../../src/audio/loops.ts';
import { FakePlayer } from '../../helpers/fakeAudio.ts';
import { registry } from '../../helpers/registry.ts';

const bindings = registry.pack.sounds!.ambience;
const place = (patch: Partial<AmbiencePlace> = {}): AmbiencePlace => ({
  biome: 'biome:meadow',
  night: false,
  cave: false,
  underwater: false,
  ...patch,
});

/** Runs the ambience for `seconds` in frames of 1/60 s (a fake clock). */
function run(ambience: Ambience, key: string | null, seconds: number): void {
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) ambience.update(key, 1 / 60);
}

describe('ambienceKey', () => {
  it("picks the biome's loop by day and by night, water first, then caves", () => {
    const tundra = bindings.biomes['biome:tundra']!;
    const desert = bindings.biomes['biome:ochre_desert']!;
    expect(ambienceKey(bindings, place({ biome: 'biome:tundra' }))).toBe(tundra.day);
    expect(ambienceKey(bindings, place({ biome: 'biome:ochre_desert', night: true }))).toBe(
      desert.night,
    );
    expect(desert.day).not.toBe(desert.night);
    expect(ambienceKey(bindings, place({ cave: true, night: true }))).toBe(bindings.cave);
    expect(ambienceKey(bindings, place({ cave: true, underwater: true }))).toBe(
      bindings.underwater,
    );
  });

  it('falls back for a biome without loops and outside the loaded world', () => {
    expect(ambienceKey(bindings, place({ biome: 'biome:elsewhere' }))).toBe(bindings.fallback.day);
    expect(ambienceKey(bindings, place({ biome: undefined, night: true }))).toBe(
      bindings.fallback.night,
    );
  });
});

describe('Ambience', () => {
  it('fades the first loop in over 3 s', () => {
    const player = new FakePlayer();
    const ambience = new Ambience(player);
    run(ambience, 'sfx:a', AMBIENCE.fadeSeconds / 2);
    expect(player.loops.get('sfx:a')).toBeCloseTo(0.5, 5);
    run(ambience, 'sfx:a', AMBIENCE.fadeSeconds);
    expect(player.loops.get('sfx:a')).toBe(1);
  });

  it('crossfades to a new loop in 3 s, then stops the old one', () => {
    const player = new FakePlayer();
    const ambience = new Ambience(player);
    run(ambience, 'sfx:day', AMBIENCE.fadeSeconds);
    run(ambience, 'sfx:night', 1);
    expect(player.loops.get('sfx:day')).toBeCloseTo(2 / 3, 5);
    expect(player.loops.get('sfx:night')).toBeCloseTo(1 / 3, 5);
    run(ambience, 'sfx:night', 2);
    expect(player.loops.get('sfx:day')).toBe(0);
    expect(player.loops.get('sfx:night')).toBeCloseTo(1, 5);
    expect(player.sounding()).toEqual(['sfx:night']);
  });

  it('turns a crossfade around half-way without a jump', () => {
    const player = new FakePlayer();
    const ambience = new Ambience(player);
    run(ambience, 'sfx:day', AMBIENCE.fadeSeconds);
    run(ambience, 'sfx:night', 1.5);
    ambience.update('sfx:day', 1 / 60);
    expect(player.loops.get('sfx:day')).toBeCloseTo(0.5 + 1 / 180, 5);
    run(ambience, 'sfx:day', AMBIENCE.fadeSeconds);
    expect(player.sounding()).toEqual(['sfx:day']);
  });

  it('stops every loop at once', () => {
    const player = new FakePlayer();
    const ambience = new Ambience(player);
    run(ambience, 'sfx:day', 1);
    run(ambience, 'sfx:night', 1);
    ambience.stop();
    expect(player.sounding()).toEqual([]);
    run(ambience, null, 1);
    expect(player.sounding()).toEqual([]);
  });
});

describe('seamless', () => {
  it('blends the end into the start, so the last sample runs into the first', () => {
    // A rising ramp 0…9 with an overlap of 4: the loop is 6 samples long.
    const ramp = Float32Array.from({ length: 10 }, (_, i) => i);
    const loop = seamless(ramp, 4);
    expect(loop).toHaveLength(6);
    // The first sample is the end's (the sample after the loop's last one), then the start's.
    expect(loop[0]).toBe(6);
    expect(loop[2]).toBeCloseTo(2 * Math.sqrt(0.5) + 8 * Math.sqrt(0.5), 5);
    expect([...loop.slice(4)]).toEqual([4, 5]);
  });

  it('keeps the level of a steady bed across the blend', () => {
    const bed = new Float32Array(100).fill(0.5);
    const loop = seamless(bed, 40);
    // Equal power: correlated samples sum up to √2 at most, never dip under the bed.
    for (const sample of loop) expect(sample).toBeGreaterThanOrEqual(0.5 - 1e-6);
    for (const sample of loop) expect(sample).toBeLessThanOrEqual(0.5 * Math.SQRT2 + 1e-6);
  });
});
