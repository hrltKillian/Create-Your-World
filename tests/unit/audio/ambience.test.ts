import { describe, expect, it } from 'vitest';
import { AMBIENCE, Ambience, type AmbiencePlace, ambienceOf } from '../../../src/audio/Ambience.ts';
import { seamless } from '../../../src/audio/loops.ts';
import type { AmbienceDef, SfxKey } from '../../../src/content/schema.ts';
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

/** One ambience per bed key, the same object each time (as the bindings hold them). */
const defs = new Map<string, AmbienceDef>();
const amb = (key: string | null): AmbienceDef | null => {
  if (key === null) return null;
  if (!defs.has(key)) defs.set(key, { bed: key as SfxKey });
  return defs.get(key)!;
};

/** Runs the ambience for `seconds` in frames of 1/60 s (a fake clock). */
function run(ambience: Ambience, key: string | null, seconds: number, def = amb(key)): void {
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) ambience.update(def, 1 / 60, 0, 64, 0);
}

describe('ambienceOf', () => {
  it("picks the biome's ambience by day and by night, water first, then caves", () => {
    const tundra = bindings.biomes['biome:tundra']!;
    const desert = bindings.biomes['biome:ochre_desert']!;
    expect(ambienceOf(bindings, place({ biome: 'biome:tundra' }))).toBe(tundra.day);
    expect(ambienceOf(bindings, place({ biome: 'biome:ochre_desert', night: true }))).toBe(
      desert.night,
    );
    expect(desert.day.bed).not.toBe(desert.night.bed);
    expect(ambienceOf(bindings, place({ cave: true, night: true }))).toBe(bindings.cave);
    expect(ambienceOf(bindings, place({ cave: true, underwater: true }))).toBe(bindings.underwater);
  });

  it('falls back for a biome without its own and outside the loaded world', () => {
    expect(ambienceOf(bindings, place({ biome: 'biome:elsewhere' }))).toBe(bindings.fallback.day);
    expect(ambienceOf(bindings, place({ biome: undefined, night: true }))).toBe(
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
    ambience.update(amb('sfx:day'), 1 / 60, 0, 64, 0);
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

describe('ambient events (plan v5 « M53 »)', () => {
  const forest: AmbienceDef = {
    bed: 'sfx:bed' as SfxKey,
    events: [{ sound: 'sfx:rustle' as SfxKey, every: [2, 4], distance: [6, 10] }],
  };

  it('drops each event at random times within its range, around the ear at its distance', () => {
    const player = new FakePlayer();
    let n = 0;
    const ambience = new Ambience(player, () => {
      n = (n * 7 + 3) % 11;
      return n / 11;
    });
    run(ambience, null, 60, forest);
    const events = player.calls.filter((c) => c.at === 'ambient');
    // Every 2 to 4 s over a minute, once the bed is up (its first second and a half).
    expect(events.length).toBeGreaterThanOrEqual(14);
    expect(events.length).toBeLessThanOrEqual(30);
    for (const event of events) {
      expect(event.key).toBe('sfx:rustle');
      expect(Math.abs(event.x)).toBeLessThanOrEqual(10);
    }
  });

  it('holds the events while the bed is faint, and plays the bed at the level given', () => {
    const player = new FakePlayer();
    const ambience = new Ambience(player, () => 0.5);
    for (let i = 0; i < 600; i++) ambience.update(forest, 1 / 60, 0, 64, 0, 0.2);
    expect(player.loops.get('sfx:bed')).toBeCloseTo(0.2, 5);
    expect(player.calls).toEqual([]);
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
