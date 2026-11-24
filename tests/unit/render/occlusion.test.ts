import { describe, expect, it } from 'vitest';
import { Occlusion } from '../../../src/render/Occlusion.ts';
import { sectionKey } from '../../../src/world/coords.ts';
import { pairBit } from '../../../src/world/mesh/visibility.ts';

/** Faces of the connectivity masks (visibility.ts): 0 +x, 1 −x, 2 +y, 3 −y, 4 +z, 5 −z. */
const UP = 2;
const DOWN = 3;
const EAST = 0;
const WEST = 1;
const SOUTH = 4;
const NORTH = 5;
const RD = 4;
/** The camera in the middle of section (0, 1, 0): a cave 40 blocks deep. */
const CAMERA = [16, 40, 16] as const;

/** Mask with the given face pairs connected. */
function through(...pairs: [number, number][]): number {
  return pairs.reduce((mask, [a, b]) => mask | (1 << pairBit(a, b)), 0);
}

/** Solid rock (mask 0) in sections sy 0 to 2 of every column within reach; air above (none). */
function sealedCave(): Map<number, number> {
  const masks = new Map<number, number>();
  for (let cx = -RD - 1; cx <= RD + 1; cx++) {
    for (let cz = -RD - 1; cz <= RD + 1; cz++) {
      for (let sy = 0; sy <= 2; sy++) masks.set(sectionKey(cx, sy, cz), 0);
    }
  }
  return masks;
}

function walked(masks: Map<number, number>): Occlusion {
  const occlusion = new Occlusion();
  occlusion.update(...CAMERA, RD, masks);
  return occlusion;
}

describe('cave occlusion culling', () => {
  it('hides the surface from a sealed cave: only the camera section and its neighbours show', () => {
    const occlusion = walked(sealedCave());
    expect(occlusion.visible(0, 1, 0)).toBe(true);
    for (const [cx, sy, cz] of [
      [1, 1, 0],
      [-1, 1, 0],
      [0, 2, 0],
      [0, 0, 0],
      [0, 1, 1],
      [0, 1, -1],
    ] as const)
      expect(occlusion.visible(cx, sy, cz), `${cx} ${sy} ${cz}`).toBe(true);
    expect(occlusion.visible(1, 1, 1)).toBe(false);
    expect(occlusion.visible(0, 3, 0)).toBe(false);
    expect(occlusion.visible(3, 5, -2)).toBe(false);
    expect(occlusion.stats().reached).toBe(7);
  });

  it('shows the surface through an open shaft, but not the rock it cannot see', () => {
    const masks = sealedCave();
    masks.set(sectionKey(0, 2, 0), through([DOWN, UP]));
    const occlusion = walked(masks);
    expect(occlusion.visible(0, 3, 0)).toBe(true);
    expect(occlusion.visible(RD, 6, -RD)).toBe(true);
    expect(occlusion.visible(-2, 3, 3)).toBe(true);
    // The rock beside the shaft: seen neither from the cave nor through the shaft.
    expect(occlusion.visible(2, 2, 0)).toBe(false);
  });

  it('counts a section whose mesh is pending (no mask) as fully connected', () => {
    const masks = sealedCave();
    masks.delete(sectionKey(0, 2, 0));
    expect(walked(masks).visible(0, 5, 0)).toBe(true);
  });

  it('never walks back towards the camera: a tunnel bending back stays hidden', () => {
    const masks = sealedCave();
    // East from the camera, south twice, then west again: the last step comes back along x.
    masks.set(sectionKey(1, 1, 0), through([WEST, SOUTH]));
    masks.set(sectionKey(1, 1, 1), through([NORTH, SOUTH]));
    masks.set(sectionKey(1, 1, 2), through([NORTH, WEST]));
    masks.set(sectionKey(0, 1, 2), through([EAST, WEST]));
    const occlusion = walked(masks);
    expect(occlusion.visible(1, 1, 1)).toBe(true);
    expect(occlusion.visible(1, 1, 2)).toBe(true);
    expect(occlusion.visible(0, 1, 2)).toBe(false);
    expect(occlusion.visible(-1, 1, 2)).toBe(false);
  });

  it('a section entered through several faces exits through each one’s pairs', () => {
    const masks = sealedCave();
    // (1, 1, 1) is entered from the north (via (1, 1, 0), the walk's first way in) and from the
    // west (via (0, 1, 1)); only its west face connects up, so the shaft above shows only when the
    // second entry is walked too.
    masks.set(sectionKey(0, 1, 1), through([NORTH, EAST]));
    masks.set(sectionKey(1, 1, 0), through([WEST, SOUTH]));
    masks.set(sectionKey(1, 1, 1), through([WEST, UP]));
    masks.set(sectionKey(1, 2, 1), through([DOWN, UP]));
    expect(walked(masks).visible(1, 3, 1)).toBe(true);
  });

  it('walks again only when the camera changes section or a mask within reach changes', () => {
    const masks = sealedCave();
    const occlusion = new Occlusion();
    expect(occlusion.update(...CAMERA, RD, masks)).toBe(true);
    expect(occlusion.update(...CAMERA, RD, masks)).toBe(false);
    // Turning or moving inside the section changes nothing.
    expect(occlusion.update(2, 33, 30, RD, masks)).toBe(false);
    occlusion.changed(RD + 3, 0);
    expect(occlusion.update(...CAMERA, RD, masks)).toBe(false);
    masks.delete(sectionKey(0, 2, 0));
    occlusion.changed(0, 0);
    expect(occlusion.update(...CAMERA, RD, masks)).toBe(true);
    expect(occlusion.visible(0, 4, 0)).toBe(true);
    expect(occlusion.update(16, 70, 16, RD, masks)).toBe(true);
    expect(occlusion.update(...CAMERA, RD + 1, masks)).toBe(true);
    expect(occlusion.stats().runs).toBe(4);
  });

  it('shows everything when turned off or with the camera outside the world height', () => {
    const occlusion = walked(sealedCave());
    expect(occlusion.visible(0, 5, 0)).toBe(false);
    occlusion.setEnabled(false);
    expect(occlusion.update(...CAMERA, RD, sealedCave())).toBe(true);
    expect(occlusion.visible(0, 5, 0)).toBe(true);
    occlusion.setEnabled(true);
    occlusion.update(16, 300, 16, RD, sealedCave());
    expect(occlusion.visible(0, 1, 0)).toBe(true);
    // Beyond the walked grid there is nothing to decide: the frustum and the fog do.
    occlusion.update(...CAMERA, RD, sealedCave());
    expect(occlusion.visible(RD + 2, 1, 0)).toBe(true);
  });
});
