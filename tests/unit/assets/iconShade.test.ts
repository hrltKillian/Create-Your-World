import { describe, expect, it } from 'vitest';
import { shadeIcon } from '../../../src/assets/procedural/iconShade.ts';
import { generatePackTexture } from '../../../src/assets/procedural/packTexture.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';

const size = basePack.manifest.textureSize;
const luma = (c: Uint8Array, o: number) => 0.2126 * c[o]! + 0.7152 * c[o + 1]! + 0.0722 * c[o + 2]!;

describe('modelled icons (plan v4 « M42 »)', () => {
  it('light a region from the top left: its top left brighter than its bottom right', () => {
    const n = 16;
    const color = new Uint8Array(n * n * 4).fill(200);
    const regions = new Int16Array(n * n).fill(-1);
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) regions[y * n + x] = 1;
    shadeIcon(color, regions, n);
    // Rows are bottom-up: the top left is (3, 12), the bottom right (12, 3).
    expect(luma(color, (12 * n + 3) * 4)).toBeGreaterThan(luma(color, (3 * n + 12) * 4));
    // Holes stay as they were.
    expect(color[0]).toBe(200);
  });

  it('keeps every solid item icon readable: its rim darker than its inside', () => {
    const icons = basePack.textures.filter((t) => t.pattern === 'icon' && t.alpha === 'coverage');
    expect(icons.length).toBeGreaterThan(20);
    for (const def of icons) {
      const color = generatePackTexture(def, size);
      const opaque = (x: number, y: number) =>
        x >= 0 && y >= 0 && x < size && y < size && color[(y * size + x) * 4 + 3] === 255;
      let rim = 0;
      let rims = 0;
      let inside = 0;
      let insides = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (!opaque(x, y)) continue;
          const edge =
            !opaque(x + 1, y) || !opaque(x - 1, y) || !opaque(x, y + 1) || !opaque(x, y - 1);
          const l = luma(color, (y * size + x) * 4);
          if (edge) {
            rim += l;
            rims++;
          } else {
            inside += l;
            insides++;
          }
        }
      }
      // Thin icons (a rod and its line) are nearly all rim: only solid ones are measured.
      if (insides < rims) continue;
      expect(rim / rims, def.key).toBeLessThan(inside / insides);
    }
  });
});
