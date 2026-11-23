import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildItemModels, MAX_ITEM_BOXES, maskRects } from '../../../src/render/itemModels.ts';
import { layers, packPixels, TEXTURE_SIZE as size } from '../../helpers/packPixels.ts';
import { registry } from '../../helpers/registry.ts';

const models = buildItemModels(registry, packPixels, size);
const model = (key: string) => models[registry.itemId(key)]!;

describe('item models', () => {
  it('covers a mask exactly with disjoint rectangles', () => {
    const mask = ['.##.', '####', '#..#', '#..#'].reverse();
    const opaque = (x: number, y: number) => mask[y]![x] === '#';
    const rects = maskRects(opaque, 4, 32);
    const hits = new Uint8Array(16);
    for (const r of rects)
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) hits[y * 4 + x]!++;
    for (let i = 0; i < 16; i++) expect(hits[i]).toBe(opaque(i % 4, Math.floor(i / 4)) ? 1 : 0);
    expect(maskRects(opaque, 4, 2)).toHaveLength(2);
  });

  it('extrudes every icon of the base pack into at most 32 boxes covering its pixels', () => {
    for (const [id, item] of registry.items.entries()) {
      if (typeof item.icon !== 'string') continue;
      const m = models[id]!;
      expect(m.sprite, item.key).toBe(true);
      expect(m.parts.length, item.key).toBeGreaterThan(0);
      expect(m.parts.length, item.key).toBeLessThanOrEqual(MAX_ITEM_BOXES);
      const layer = registry.textureKeys.indexOf(item.icon);
      let opaque = 0;
      for (let i = 3; i < size * size * 4; i += 4) if (layers[layer]![i]! > 127) opaque++;
      const covered = m.parts.reduce((sum, p) => sum + p.skin.sx * p.skin.sy * size * size, 0);
      expect(Math.round(covered), item.key).toBe(opaque);
      for (const p of m.parts) expect(p.skin.sprite && p.skin.side === layer).toBe(true);
    }
  });

  it('draws block items as their block: a textured cube, or the shape boxes of a torch', () => {
    const dirt = model('item:dirt');
    expect(dirt.sprite).toBe(false);
    expect(dirt.parts).toHaveLength(1);
    const state = registry.defaultState('block:dirt');
    expect(dirt.parts[0]!.skin.side).toBe(registry.tables.faceLayer[state * 6 + 4]);
    const corner = new Vector3(1, 1, 1).applyMatrix4(dirt.parts[0]!.box);
    expect(corner.toArray()).toEqual([0.5, 0.5, 0.5]);
    const torch = model('item:torch').parts[0]!;
    const low = new Vector3(0, 0, 0).applyMatrix4(torch.box);
    const high = new Vector3(1, 1, 1).applyMatrix4(torch.box);
    expect([low.x, low.y, high.x, high.y]).toEqual([
      7 / 16 - 0.5,
      -0.5,
      9 / 16 - 0.5,
      10 / 16 - 0.5,
    ]);
    expect(torch.skin.ox).toBe(7 / 16);
  });

  it('gives every item a single far box', () => {
    for (const m of models) expect(m.far.box).toBeDefined();
    const knife = model('item:flint_knife');
    expect(knife.far.skin.sprite).toBe(true);
    expect(knife.far.skin.sx).toBeGreaterThan(0.5);
  });
});
