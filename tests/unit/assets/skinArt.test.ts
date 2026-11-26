import { describe, expect, it } from 'vitest';
import { GLOW_ALPHA, skinMaterial, skinPixels } from '../../../src/assets/procedural/skinArt.ts';
import { SKIN_SIZE } from '../../../src/content/schema.ts';

/* Plan v5 « M52 »: a skin atlas as a texture layer, rows from the top, glow in the alpha. */

describe('skin pixels', () => {
  it('writes each texel from the top, glowing ones at GLOW_ALPHA, empty ones clear', () => {
    const pixels = skinPixels({
      key: 'skin:test',
      palette: ['#102030', '#ffaa00'],
      mask: ['0.1', '', '1'],
      glow: [1],
    });
    expect(pixels).toHaveLength(SKIN_SIZE * SKIN_SIZE * 4);
    const at = (x: number, y: number) => [
      ...pixels.slice((y * SKIN_SIZE + x) * 4, (y * SKIN_SIZE + x) * 4 + 4),
    ];
    expect(at(0, 0)).toEqual([0x10, 0x20, 0x30, 255]);
    expect(at(1, 0)).toEqual([0, 0, 0, 0]);
    expect(at(2, 0)).toEqual([0xff, 0xaa, 0x00, GLOW_ALPHA]);
    expect(at(0, 1)).toEqual([0, 0, 0, 0]);
    expect(at(0, 2)).toEqual([0xff, 0xaa, 0x00, GLOW_ALPHA]);
  });
});

describe('skin relief', () => {
  it('tilts the normal from a dark texel towards a lit one, flat on an even face', () => {
    const material = skinMaterial({
      key: 'skin:test',
      palette: ['#202020', '#e0e0e0'],
      mask: ['0001111', '0001111'],
    });
    const normalX = (x: number) => material[x * 4]!;
    expect(normalX(1)).toBe(128);
    // Brighter to the right: the surface rises that way, its normal leans left (below 0.5).
    expect(normalX(3)).toBeLessThan(110);
    expect(material[3]).toBe(255);
    expect(material[(SKIN_SIZE + 9) * 4 + 3]).toBe(0);
  });
});
