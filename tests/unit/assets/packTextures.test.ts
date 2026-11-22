import { describe, expect, it } from 'vitest';
import { generatePackTexture } from '../../../src/assets/procedural/patterns.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { fnv1aBytes } from '../../../src/core/hash.ts';

const size = basePack.manifest.textureSize;
const alphas = (bytes: Uint8Array) => {
  const values = new Set<number>();
  for (let i = 3; i < bytes.length; i += 4) values.add(bytes[i]!);
  return values;
};

describe('base pack textures', () => {
  it('generates every texture deterministically', () => {
    const hashes = basePack.textures.map((def) => {
      const bytes = generatePackTexture(def, size);
      expect(bytes.length).toBe(size * size * 4);
      expect(fnv1aBytes(generatePackTexture(def, size))).toBe(fnv1aBytes(bytes));
      return [def.key, fnv1aBytes(bytes).toString(16)];
    });
    expect(new Set(hashes.map(([, h]) => h)).size).toBe(hashes.length);
    expect(Object.fromEntries(hashes)).toMatchSnapshot();
  });

  it('follows each alpha convention', () => {
    for (const def of basePack.textures) {
      const values = alphas(generatePackTexture(def, size));
      const alpha = 'alpha' in def ? def.alpha : 'opaque';
      if (alpha === 'opaque' || alpha === 'tintFull') expect([...values], def.key).toEqual([255]);
      else if (alpha === 'emissiveMask' || alpha === 'tintMask') {
        expect(values.has(0) && values.has(255), def.key).toBe(true);
      } else if (def.pattern !== 'ripple') {
        expect(values.has(0), `${def.key} should have holes`).toBe(true);
      }
    }
  });

  it('keeps foliage at least 60 % opaque so mipmaps do not erase it', () => {
    const leaves = basePack.textures.find((t) => t.key === 'tex:foliage')!;
    const bytes = generatePackTexture(leaves, size);
    let opaque = 0;
    for (let i = 3; i < bytes.length; i += 4) if (bytes[i] === 255) opaque++;
    expect(opaque / (size * size)).toBeGreaterThanOrEqual(0.6);
  });
});
