import { describe, expect, it } from 'vitest';
import { figurePixels } from '../../../src/assets/procedural/figure.ts';
import { layers, TEXTURE_SIZE } from '../../helpers/packPixels.ts';
import { registry } from '../../helpers/registry.ts';

describe('the avatar’s figure (plan v5 « M51 »)', () => {
  it('draws the survivor from the front, from its own skins, two texels a unit', () => {
    const figure = figurePixels(registry, layers, TEXTURE_SIZE)!;
    const model = registry.model(registry.pack.manifest.bindings.avatarModel!)!;
    const top = Math.max(...model.parts.map((p) => p.to[1]));
    expect(figure.height).toBe(Math.ceil(top * (TEXTURE_SIZE / 16)));
    // Its head's face: the head's front texture, texel for texel, in the middle of the top.
    const head = model.parts.find((p) => p.name === 'head')!;
    const art = registry.pack.textures.find((t) => t.key === head.faces!.front)!;
    const alpha = (x: number, y: number) => figure.pixels[(y * figure.width + x) * 4 + 3]!;
    const middle = Math.floor(figure.width / 2);
    expect(alpha(middle, Math.round((top - head.to[1] + 3) * 2))).toBe(255);
    expect(art.mask).toBeDefined();
    // Nothing above the hair, nothing beside the arms.
    expect(alpha(0, 0)).toBe(0);
    let opaque = 0;
    for (let i = 3; i < figure.pixels.length; i += 4) if (figure.pixels[i] === 255) opaque++;
    expect(opaque).toBeGreaterThan(figure.width * figure.height * 0.4);
  });
});
