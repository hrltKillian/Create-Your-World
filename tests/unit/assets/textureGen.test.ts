import { describe, expect, it } from 'vitest';
import { generateTexture, parseHex } from '../../../src/assets/procedural/textureGen.ts';
import { fnv1aBytes } from '../../../src/core/hash.ts';

const stone = { pattern: 'speckle', palette: ['#404040', '#606060', '#808080'], seed: 1 } as const;

describe('procedural textures', () => {
  it('produces opaque RGBA bytes of the right size', () => {
    const bytes = generateTexture(stone, 16);
    expect(bytes.length).toBe(16 * 16 * 4);
    for (let i = 3; i < bytes.length; i += 4) expect(bytes[i]).toBe(255);
  });

  it('only uses palette colours', () => {
    const palette = new Set(stone.palette.map((hex) => parseHex(hex).join(',')));
    const bytes = generateTexture(stone, 16);
    for (let i = 0; i < bytes.length; i += 4) {
      expect(palette.has(`${bytes[i]},${bytes[i + 1]},${bytes[i + 2]}`)).toBe(true);
    }
  });

  it('is deterministic and varies with the seed', () => {
    const a = fnv1aBytes(generateTexture(stone));
    expect(fnv1aBytes(generateTexture(stone))).toBe(a);
    expect(fnv1aBytes(generateTexture({ ...stone, seed: 2 }))).not.toBe(a);
    for (const pattern of ['planks', 'ore'] as const) {
      const recipe = {
        pattern,
        palette: ['#111111', '#333333', '#555555', '#777777', '#999999'],
        seed: 5,
      };
      expect(generateTexture(recipe).length).toBe(1024);
    }
  });
});
