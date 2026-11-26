import { describe, expect, it } from 'vitest';
import { beast, legPair } from '../../../src/content/packs/base/beasts/build.ts';
import { coat, Face, scutes, tone } from '../../../src/content/packs/base/beasts/paint.ts';
import { trotter } from '../../../src/content/packs/base/beasts/trotter.ts';
import { creatureModels, creatureSkins } from '../../../src/content/packs/base/creatureModels.ts';
import { PALETTE } from '../../../src/content/packs/base/palette.ts';
import { SKIN_SIZE, SKIN_TEXELS, skinFaces } from '../../../src/content/schema.ts';

/*
 * Plan v5 « M52 » (decision 39): the creatures' jointed models, each skinned by one atlas painted
 * in the palette and unfolded the reference game's way; parts of one skin share their place.
 */

describe('the painted creatures', () => {
  it('skin every creature with one atlas of the palette’s colours, within SKIN_SIZE', () => {
    expect(creatureModels.map((m) => m.skin)).toEqual(creatureSkins.map((s) => s.key));
    for (const skin of creatureSkins) {
      expect(skin.mask.length, skin.key).toBeLessThanOrEqual(SKIN_SIZE);
      for (const row of skin.mask) expect(row.length, skin.key).toBeLessThanOrEqual(SKIN_SIZE);
      for (const colour of skin.palette)
        expect(PALETTE.has(colour), `${skin.key} ${colour}`).toBe(true);
    }
  });

  it('gives richer models than boxes on legs: joints and at least 16 parts each', () => {
    for (const model of creatureModels) {
      expect(model.parts.length, model.key).toBeGreaterThanOrEqual(16);
      expect(
        model.parts.some((p) => p.name.startsWith('shin')),
        model.key,
      ).toBe(true);
      expect(
        model.parts.some((p) => p.name === 'head'),
        model.key,
      ).toBe(true);
    }
  });

  it('places parts of one skin together and keeps each part’s faces apart from the others’', () => {
    const { model } = trotter;
    const uv = (name: string) => model.parts.find((p) => p.name === name)!.uv;
    expect(uv('shinFL')).toEqual(uv('shinBR'));
    expect(uv('earL')).toEqual(uv('earR'));
    // No two places overlap in the atlas.
    const rects = new Map<string, number[]>();
    for (const part of model.parts) {
      const size = (a: number) => Math.round((part.to[a]! - part.from[a]!) * SKIN_TEXELS);
      const [w, h, d] = [size(0), size(1), size(2)];
      rects.set(String(part.uv), [part.uv![0], part.uv![1], 2 * d + 2 * w, d + h]);
    }
    const all = [...rects.values()];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const [a, b] = [all[i]!, all[j]!];
        const apart =
          a[0]! + a[2]! <= b[0]! ||
          b[0]! + b[2]! <= a[0]! ||
          a[1]! + a[3]! <= b[1]! ||
          b[1]! + b[3]! <= a[1]!;
        expect(apart, `${a} ${b}`).toBe(true);
      }
  });

  it('unfolds a box the reference game’s way: each face painted where skinFaces puts it', () => {
    const built = beast({
      name: 'cube',
      gait: 'biped',
      stride: 1,
      mats: ['wood', 'stone'],
      parts: [
        ...legPair(
          '',
          { x: [-2, -1], y: [1, 2], z: [0, 1], skin: 'leg' },
          { x: [-2, -1], y: [0, 1], z: [0, 1], skin: 'leg' },
        ),
        { name: 'body', from: [0, 0, 0], to: [2, 1.5, 1], pivot: [0, 0, 0] },
      ],
      paint: {
        leg: { side: (w, h) => new Face(w, h, tone(0, 3)) },
        body: {
          side: (w, h) => new Face(w, h, tone(0, 1)),
          front: (w, h) => new Face(w, h, tone(0, 2)),
          back: (w, h) => new Face(w, h, tone(0, 3)),
          top: (w, h) => new Face(w, h, tone(0, 4)),
          bottom: (w, h) => new Face(w, h, tone(1, 1)),
        },
      },
    });
    const body = built.model.parts.find((p) => p.name === 'body')!;
    const [u, v] = body.uv!;
    const letter = (face: keyof ReturnType<typeof skinFaces>) => {
      const [fu, fv] = skinFaces(4, 3, 2)[face];
      return built.skin.mask[v + fv!]![u + fu!];
    };
    const colour = (ch: string | undefined) => built.skin.palette['0123456789'.indexOf(ch!)];
    expect([colour(letter('right')), colour(letter('left'))]).toEqual([
      colour(letter('right')),
      colour(letter('right')),
    ]);
    expect(
      new Set(['top', 'bottom', 'right', 'front', 'back'].map((f) => letter(f as 'top'))).size,
    ).toBe(5);
  });

  it('paints deterministically, a coat lit on top and shaded below, scutes with seams', () => {
    expect(JSON.stringify(coat(8, 6, 0, { seed: 3 }))).toBe(
      JSON.stringify(coat(8, 6, 0, { seed: 3 })),
    );
    const f = coat(6, 6, 0, { base: 3, top: 1, bottom: 1, grain: 'smooth' });
    expect(f.get(2, 0) >= f.get(2, 3)).toBe(true);
    const s = scutes(new Face(8, 8), 0, 4, 4);
    expect(s.get(3, 0)).toBe(tone(0, 1));
    expect(s.get(0, 3)).toBe(tone(0, 1));
  });
});
