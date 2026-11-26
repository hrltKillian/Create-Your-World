import { describe, expect, it } from 'vitest';
import { materialLayer } from '../../../src/assets/procedural/materialMap.ts';
import { renderPackTexture } from '../../../src/assets/procedural/packTexture.ts';
import { parseHex } from '../../../src/assets/procedural/palette.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';

const size = basePack.manifest.textureSize;
const rendered = basePack.textures.map((def) => ({ def, ...renderPackTexture(def, size) }));
const byKey = (key: string) => rendered.find((r) => r.def.key === key)!;

/** Mean absolute colour step between texel columns `a` and `b` (wrapping). */
function columnStep(color: Uint8Array, a: number, b: number): number {
  let sum = 0;
  for (let y = 0; y < size; y++) {
    for (let k = 0; k < 3; k++)
      sum += Math.abs(color[(y * size + a) * 4 + k]! - color[(y * size + b) * 4 + k]!);
  }
  return sum / (size * 3);
}

describe('material layers (plan v4 « M36 »)', () => {
  it('keeps every normal within the unit disc, flat ones at the middle', () => {
    for (const { def, material } of rendered) {
      for (let i = 0; i < material.length; i += 4) {
        const nx = material[i]! / 127.5 - 1;
        const ny = material[i + 1]! / 127.5 - 1;
        expect(nx * nx + ny * ny, def.key).toBeLessThanOrEqual(1.02);
      }
    }
    const flat = materialLayer(new Float32Array(16).fill(0.5), new Float32Array(16), 4, 2);
    for (let i = 0; i < flat.length; i += 4) {
      expect([flat[i], flat[i + 1], flat[i + 3]]).toEqual([128, 128, 255]);
    }
  });

  it('tilts the normal down the slope and darkens the hollows', () => {
    const heights = new Float32Array(64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) heights[y * 8 + x] = x === 3 ? 0 : 1;
    const layer = materialLayer(heights, new Float32Array(64), 8, 1);
    const at = (x: number, k: number) => layer[(2 * 8 + x) * 4 + k]!;
    // Left of the groove the ground falls towards +x: the normal leans +x; right of it, −x.
    expect(at(2, 0)).toBeGreaterThan(128);
    expect(at(4, 0)).toBeLessThan(128);
    expect(at(3, 3)).toBeLessThan(at(6, 3));
  });

  it('tiles natural textures without a seam', () => {
    for (const key of ['tex:stone', 'tex:dirt', 'tex:sand', 'tex:gravel', 'tex:grass_top']) {
      const { color } = byKey(key);
      let inside = 0;
      for (let x = 0; x < size - 1; x++) inside += columnStep(color, x, x + 1);
      inside /= size - 1;
      expect(columnStep(color, size - 1, 0), key).toBeLessThan(inside * 2);
    }
  });

  it('gives the roughness of the definition, the mask texels their own', () => {
    const glass = byKey('tex:glass');
    expect(glass.material[2]).toBe(Math.round(0.05 * 255));
    const ore = byKey('tex:copper_ore');
    const values = new Set<number>();
    for (let i = 2; i < ore.material.length; i += 4) values.add(ore.material[i]!);
    expect(values).toEqual(new Set([Math.round(0.85 * 255), Math.round(0.35 * 255)]));
  });

  it('draws accent spots in their own colour', () => {
    const bush = byKey('tex:berry_bush');
    const berry = parseHex(bush.def.palette.at(-1)!).join(',');
    let spots = 0;
    for (let i = 0; i < bush.color.length; i += 4)
      if (`${bush.color[i]},${bush.color[i + 1]},${bush.color[i + 2]}` === berry) spots++;
    expect(spots).toBeGreaterThan(size);
  });

  it('keeps both texture arrays small', () => {
    // Colours and materials, RGBA bytes, with a third more for the mipmaps.
    const bytes = rendered.length * size * size * 4 * 2 * (4 / 3);
    expect(bytes).toBeLessThan(4 * 1024 * 1024);
  });
});
