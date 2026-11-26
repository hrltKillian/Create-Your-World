import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { art, INK, PALETTE, RAMPS } from '../../../src/content/packs/base/palette.ts';

/*
 * Plan v5 « M49 » (decision 35): every item icon is pixel art drawn by hand on a 32 × 32 grid,
 * in colours of the pack's one palette only.
 */

const icons = [...basePack.textures, ...(basePack.icons ?? [])].filter((t) =>
  t.key.startsWith('tex:icon_'),
);

describe('the palette and the hand-drawn icons', () => {
  it('has six tones a ramp, darkest first, and an ink of its own', () => {
    const luma = (hex: string) => {
      const n = Number.parseInt(hex.slice(1), 16);
      return 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255);
    };
    for (const [mat, ramp] of Object.entries(RAMPS)) {
      expect(ramp, mat).toHaveLength(6);
      for (let i = 1; i < ramp.length; i++)
        expect(luma(ramp[i]!), mat).toBeGreaterThan(luma(ramp[i - 1]!));
    }
    expect(PALETTE.has(INK)).toBe(true);
  });

  it('draws every item icon on a 32 × 32 grid, in the palette’s colours only', () => {
    // The items' own (plan v5 « M49 ») and the blocks' (« M50 »).
    expect(icons.length).toBeGreaterThanOrEqual(75 + 69);
    for (const icon of icons) {
      expect(icon.pattern, icon.key).toBe('icon');
      expect(icon.mask, icon.key).toHaveLength(32);
      for (const row of icon.mask!) expect(row.length, icon.key).toBe(32);
      for (const colour of icon.palette)
        expect(PALETTE.has(colour), `${icon.key} ${colour}`).toBe(true);
      expect(new Set(icon.palette).size, icon.key).toBe(icon.palette.length);
    }
  });

  it('gives every item of its own a drawn icon (blocks show their block)', () => {
    for (const item of basePack.items ?? []) {
      if (item.key === basePack.manifest.bindings.unknownItem) continue;
      expect(typeof item.icon === 'string' && item.icon.startsWith('tex:icon_'), item.key).toBe(
        true,
      );
      expect(
        icons.some((t) => t.key === item.icon),
        item.key,
      ).toBe(true);
    }
  });

  it('reads a grid’s letters as ink, white glints and the materials’ tones', () => {
    const row = `#Wabcde${'.'.repeat(25)}`;
    const icon = art('tex:icon_test', ['wood'], Array.from({ length: 32 }, () => row).join('\n'));
    expect(icon.palette).toEqual([INK, RAMPS.shine[5], ...RAMPS.wood.slice(1)]);
    expect(icon.mask![0]).toBe(`0123456${'.'.repeat(25)}`);
    expect(() => art('tex:icon_test', ['wood'], 'f')).toThrow();
  });
});
