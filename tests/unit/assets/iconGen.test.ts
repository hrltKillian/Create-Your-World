import { describe, expect, it } from 'vitest';
import { ICON_SIZE, itemIconPixels } from '../../../src/assets/procedural/iconGen.ts';
import { fnv1aBytes } from '../../../src/core/hash.ts';
import { layers, TEXTURE_SIZE } from '../../helpers/packPixels.ts';
import { registry } from '../../helpers/registry.ts';

const icon = (key: string) => itemIconPixels(registry, registry.itemId(key), layers, TEXTURE_SIZE);
const alphaAt = (pixels: Uint8ClampedArray, x: number, y: number) =>
  pixels[(y * ICON_SIZE + x) * 4 + 3]!;

/** Mean brightness of the opaque pixels of a square region. */
function brightness(pixels: Uint8ClampedArray, x0: number, y0: number, side: number): number {
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y0 + side; y++) {
    for (let x = x0; x < x0 + side; x++) {
      const o = (y * ICON_SIZE + x) * 4;
      if (pixels[o + 3] === 0) continue;
      sum += pixels[o]! + pixels[o + 1]! + pixels[o + 2]!;
      n++;
    }
  }
  return sum / n;
}

describe('item icons', () => {
  it('draws every item, with crisp alpha and a deterministic result', () => {
    for (let id = 0; id < registry.items.length; id++) {
      const pixels = itemIconPixels(registry, id, layers, TEXTURE_SIZE);
      expect(pixels.length).toBe(ICON_SIZE * ICON_SIZE * 4);
      let opaque = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        expect([0, 255]).toContain(pixels[i]);
        if (pixels[i] === 255) opaque++;
      }
      expect(opaque, registry.items[id]!.key).toBeGreaterThan(ICON_SIZE * 3);
      expect(fnv1aBytes(itemIconPixels(registry, id, layers, TEXTURE_SIZE))).toBe(
        fnv1aBytes(pixels),
      );
    }
  });

  it('draws a block as an isometric cube: lit top, two shaded sides, clear corners', () => {
    const dirt = icon('item:dirt');
    for (const [x, y] of [
      [0, 0],
      [31, 0],
      [0, 31],
      [31, 31],
    ] as const)
      expect(alphaAt(dirt, x, y)).toBe(0);
    const top = brightness(dirt, 12, 4, 8);
    const left = brightness(dirt, 3, 16, 8);
    const right = brightness(dirt, 21, 16, 8);
    expect(top).toBeGreaterThan(left);
    expect(left).toBeGreaterThan(right);
  });

  it('draws an item from its hand-drawn 32 × 32 grid, one pixel a pixel (plan v5 « M49 »)', () => {
    const knife = icon('item:flint_knife');
    const mask = registry.pack.textures.find((t) => t.key === 'tex:icon_flint_knife')!.mask!;
    expect(mask.length).toBe(ICON_SIZE);
    for (let y = 0; y < ICON_SIZE; y++)
      for (let x = 0; x < ICON_SIZE; x++)
        expect(alphaAt(knife, x, y), `${x}, ${y}`).toBe(mask[y]![x] === '.' ? 0 : 255);
  });
});
