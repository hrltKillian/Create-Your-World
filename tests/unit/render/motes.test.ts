import { describe, expect, it } from 'vitest';
import { BoxBatch } from '../../../src/render/BoxBatch.ts';
import { Motes, nightShare } from '../../../src/render/Motes.ts';
import { boxUniforms } from '../../helpers/boxUniforms.ts';
import { emptyWorld, flatWorld } from '../../helpers/flatWorld.ts';
import { registry } from '../../helpers/registry.ts';

const TEXEL = { layer: 0, u: 0.5, v: 0.5 };
const LOOK = { color: '#7fe0c8', count: 40, night: 1 };

function setup(world = emptyWorld(2)) {
  const batch = new BoxBatch(boxUniforms, 256, true);
  return { batch, motes: new Motes(batch, world, registry.tables, TEXEL) };
}

describe('motes (plan v4 « M40 »)', () => {
  it('come with the night: none by day, all of them deep in the night', () => {
    expect(nightShare(1)).toBe(0);
    expect(nightShare(0.6)).toBe(0);
    expect(nightShare(0.12)).toBe(1);
    expect(nightShare(0.4)).toBeGreaterThan(0);
    expect(nightShare(0.4)).toBeLessThan(1);
  });

  it("draw at most the biome's count of glowing boxes, none without a look", () => {
    const { batch, motes } = setup();
    batch.begin(0, 0, 0);
    motes.draw(0.016, 0.5, 70, 0.5, LOOK);
    expect(motes.drawn).toBeGreaterThan(LOOK.count / 2);
    expect(motes.drawn).toBeLessThanOrEqual(LOOK.count);
    expect(batch.size).toBe(motes.drawn);
    motes.draw(0.016, 0.5, 70, 0.5, null);
    expect(motes.drawn).toBe(0);
    motes.draw(0.016, 0.5, 70, 0.5, { ...LOOK, night: 0 });
    expect(motes.drawn).toBe(0);
  });

  it('keep their place in the world as the eye moves a little', () => {
    const a = setup();
    const b = setup();
    a.batch.begin(0, 0, 0);
    b.batch.begin(0, 0, 0);
    a.motes.draw(0, 0.5, 70, 0.5, LOOK);
    b.motes.draw(0, 1.5, 70, 0.5, LOOK);
    const first = (batch: BoxBatch) => Array.from(batch.mesh.instanceMatrix.array.slice(12, 15));
    expect(first(a.batch)).toEqual(first(b.batch));
  });

  it('never hang inside solid blocks', () => {
    const { batch, motes } = setup(flatWorld());
    batch.begin(0, 0, 0);
    // The eye at the ground: the lower band of the motes crosses the stone layer (y 63).
    motes.draw(0.016, 0.5, 64.5, 0.5, { ...LOOK, count: 64 });
    const m = batch.mesh.instanceMatrix.array;
    expect(motes.drawn).toBeGreaterThan(0);
    for (let i = 0; i < motes.drawn; i++) {
      const centre = m[i * 16 + 13]! + m[i * 16 + 5]! / 2;
      expect(Math.floor(centre)).not.toBe(63);
    }
  });
});
