import { describe, expect, it } from 'vitest';
import { FACE_SOUTH, FACE_UP, TINT_NONE } from '../../../src/content/registry.ts';
import { BOX_NO_TINT, BoxBatch } from '../../../src/render/BoxBatch.ts';
import {
  LAND_DUST_MAX,
  LAND_DUST_PER_BLOCK,
  MINE_DUST,
  Particles,
  PER_BREAK,
  TRAIL_BOXES,
} from '../../../src/render/Particles.ts';
import { palestTexel, patchCorner } from '../../../src/render/particleArt.ts';
import { columnIndex } from '../../../src/world/coords.ts';
import { tintIndex } from '../../../src/world/mesh/greedyMesher.ts';
import type { VoxelWorld } from '../../../src/world/VoxelWorld.ts';
import { boxUniforms } from '../../helpers/boxUniforms.ts';
import { flatWorld } from '../../helpers/flatWorld.ts';
import { packPixels, TEXTURE_SIZE } from '../../helpers/packPixels.ts';
import { registry } from '../../helpers/registry.ts';

const STONE = registry.defaultState('block:stone');
const GRASS = registry.defaultState('block:grass');
const TALL_GRASS = registry.defaultState('block:tall_grass');
const AIR = registry.air;
/** A distinct box tint per chunk tint index (0 is untinted, as in the chunks' table). */
const TINTS = Array.from({ length: 32 }, (_, i) => (i === 0 ? BOX_NO_TINT : 0x010203 * i));
const FRAME = 1 / 60;

function setup(world: VoxelWorld = flatWorld()) {
  const batch = new BoxBatch(boxUniforms, 256, true);
  const art = { tints: TINTS, texels: packPixels, size: TEXTURE_SIZE };
  const particles = new Particles(batch, world, registry.tables, art);
  /** One frame: moves the particles and returns the boxes drawn. */
  const frame = (dt = FRAME) => {
    batch.begin(0, 0, 0);
    particles.update(dt);
    batch.end();
    return batch.size;
  };
  const attribute = (name: string) => batch.mesh.geometry.getAttribute(name);
  return { batch, particles, frame, attribute };
}

/** Particles alive after `seconds` of 60 fps frames. */
function aliveAfter(p: ReturnType<typeof setup>, seconds: number): number {
  for (let t = 0; t < seconds * 60; t++) p.frame();
  return p.particles.alive();
}

describe('break chips', () => {
  it('throws chips of the broken block that fall, land and fade', () => {
    const p = setup();
    p.particles.burst(0, 63, 0, STONE);
    expect(p.particles.alive()).toBe(PER_BREAK);
    expect(p.frame()).toBe(PER_BREAK);
    expect(p.attribute('aLayers').getX(0)).toBe(registry.tables.faceLayer[STONE * 6 + FACE_SOUTH]);
    expect(aliveAfter(p, 1.5)).toBe(0);
  });

  it('tints chips like the chunks tint the block face in its biome', () => {
    const world = flatWorld();
    const biome = 2;
    world.getBiomes(0, 0)![columnIndex(0, 0)] = biome;
    const p = setup(world);
    const channel = registry.tables.faceTint[GRASS * 6 + FACE_SOUTH]!;
    expect(channel).not.toBe(TINT_NONE);
    p.particles.burst(0, 63, 0, GRASS);
    p.frame();
    const tints = p.attribute('aTints');
    for (let i = 0; i < PER_BREAK; i++) {
      expect(tints.getX(i)).toBe(TINTS[tintIndex(channel, biome)]);
      expect(tints.getY(i)).toBe(tints.getX(i));
      // An opaque block's alpha masks the tint, as in the chunks.
      expect(tints.getW(i)).toBe(0);
    }
    p.particles.burst(0, 63, 0, STONE);
    p.frame();
    expect(tints.getX(PER_BREAK)).toBe(BOX_NO_TINT);
  });

  it('cuts the chips of a cutout block from covered texels only', () => {
    const p = setup();
    p.particles.burst(0, 64, 0, TALL_GRASS);
    p.frame();
    const layer = registry.tables.faceLayer[TALL_GRASS * 6 + FACE_SOUTH]!;
    const origins = p.attribute('aTexOrigin');
    for (let i = 0; i < PER_BREAK; i++) {
      expect(p.attribute('aTints').getW(i)).toBe(1);
      const px = Math.round(origins.getX(i) * TEXTURE_SIZE);
      const py = Math.round(origins.getY(i) * TEXTURE_SIZE);
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const texel = (layer * TEXTURE_SIZE + py + dy!) * TEXTURE_SIZE + px + dx!;
        expect(packPixels[texel * 4 + 3]).toBeGreaterThan(90);
      }
    }
  });
});

describe('dust', () => {
  it('puffs from a mined block towards the eye, rising and fading', () => {
    const p = setup();
    p.particles.mineDust(0, 63, 0, STONE, 0.5, 65.6, 3.5);
    expect(p.particles.alive()).toBe(MINE_DUST);
    expect(p.frame()).toBe(MINE_DUST);
    // From the block's top face, on the eye's side.
    const matrices = p.batch.mesh.instanceMatrix.array;
    const startY = matrices[13]!;
    expect(startY).toBeGreaterThan(63.7);
    for (let t = 0; t < 12; t++) p.frame();
    expect(matrices[13]!).toBeGreaterThan(startY);
    expect(aliveAfter(p, 1)).toBe(0);
  });

  it('throws more dust for a longer fall, none off solid ground', () => {
    const p = setup();
    p.particles.landDust(0.5, 64, 0.5, STONE, 2);
    expect(p.particles.alive()).toBe(2 * LAND_DUST_PER_BLOCK);
    expect(aliveAfter(p, 1)).toBe(0);
    p.particles.landDust(0.5, 64, 0.5, STONE, 30);
    expect(p.particles.alive()).toBe(LAND_DUST_MAX);
    expect(aliveAfter(p, 1)).toBe(0);
    p.particles.landDust(0.5, 64, 0.5, AIR, 3);
    expect(p.particles.alive()).toBe(0);
    // Landing dust shows the top of the ground.
    p.particles.landDust(0.5, 64, 0.5, GRASS, 1);
    p.frame();
    expect(p.attribute('aLayers').getX(0)).toBe(registry.tables.faceLayer[GRASS * 6 + FACE_UP]);
  });
});

describe('attack trail', () => {
  it('draws a short arc of glowing boxes ahead of the eye', () => {
    const p = setup();
    // Looking north (−z) from (0.5, 65.6, 0.5).
    p.particles.trail(0.5, 65.6, 0.5, 0, 0);
    expect(p.particles.alive()).toBe(TRAIL_BOXES);
    expect(p.frame()).toBe(TRAIL_BOXES);
    const matrices = p.batch.mesh.instanceMatrix.array;
    const xs: number[] = [];
    for (let i = 0; i < TRAIL_BOXES; i++) {
      expect(matrices[i * 16 + 14]!).toBeLessThan(0.5 - 0.4);
      expect(p.attribute('aFx').getX(i)).toBeGreaterThan(0);
      xs.push(matrices[i * 16 + 12]!);
    }
    // From the right of the view to its middle, the arm's stroke.
    expect(xs[0]!).toBeGreaterThan(xs.at(-1)! + 0.2);
    // Its start fades first.
    for (let t = 0; t < 6; t++) p.frame();
    expect(p.particles.alive()).toBeGreaterThan(0);
    expect(p.particles.alive()).toBeLessThan(TRAIL_BOXES);
    expect(aliveAfter(p, 0.25)).toBe(0);
  });
});

describe('particles setting', () => {
  it('makes no particle while off, and clears the live ones', () => {
    const p = setup();
    p.particles.burst(0, 63, 0, STONE);
    p.particles.setEnabled(false);
    expect(p.particles.alive()).toBe(0);
    p.particles.burst(0, 63, 0, STONE);
    p.particles.mineDust(0, 63, 0, STONE, 0.5, 65.6, 3.5);
    p.particles.landDust(0.5, 64, 0.5, STONE, 3);
    p.particles.trail(0.5, 65.6, 0.5, 0, 0);
    expect(p.particles.alive()).toBe(0);
    expect(p.frame()).toBe(0);
    p.particles.setEnabled(true);
    p.particles.burst(0, 63, 0, STONE);
    expect(p.particles.alive()).toBe(PER_BREAK);
  });
});

describe('particle art', () => {
  it('finds the palest fully opaque texel of the texture array', () => {
    // Two 2 × 2 layers: a white hole, a grey texel, then the palest opaque one at layer 1 (1, 1).
    const texels = new Uint8Array(2 * 4 * 4);
    texels.set([255, 255, 255, 0], 0);
    texels.set([120, 120, 120, 255], 4);
    texels.set([230, 235, 240, 255], (4 + 3) * 4);
    expect(palestTexel(texels, 2)).toEqual({ layer: 1, x: 1, y: 1 });
  });

  it('picks any patch corner, or for a cutout layer the next one without a hole', () => {
    // One 3 × 3 layer (four 2 × 2 patches): only its bottom-right patch, from (1, 1), is covered.
    const texels = new Uint8Array(3 * 3 * 4);
    for (const [x, y] of [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ])
      texels[(y! * 3 + x!) * 4 + 3] = 255;
    const art = { tints: [], texels, size: 3 };
    // Corners 0…3 are (0, 0), (1, 0), (0, 1), (1, 1): as texels 0, 1, 3 and 4.
    expect([0, 0.3, 0.6, 0.9].map((pick) => patchCorner(art, 0, false, pick))).toEqual([
      0, 1, 3, 4,
    ]);
    expect([0, 0.3, 0.6, 0.9].map((pick) => patchCorner(art, 0, true, pick))).toEqual([4, 4, 4, 4]);
    // A layer with holes everywhere keeps the picked corner.
    expect(patchCorner({ ...art, texels: new Uint8Array(36) }, 0, true, 0.3)).toBe(1);
  });
});
