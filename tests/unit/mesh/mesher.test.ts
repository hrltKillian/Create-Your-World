import { describe, expect, it } from 'vitest';
import { Rng } from '../../../src/core/rng.ts';
import { localIndex } from '../../../src/world/coords.ts';
import { meshSection, type SectionMesh } from '../../../src/world/mesh/greedyMesher.ts';
import { createPadded, fillPadded, type PaddedFill } from '../../../src/world/mesh/padded.ts';
import { packW0, packW1, unpackVertex } from '../../../src/world/mesh/vertexFormat.ts';
import { pairBit } from '../../../src/world/mesh/visibility.ts';
import { VoxelWorld } from '../../../src/world/VoxelWorld.ts';
import { registry } from '../../helpers/registry.ts';

const S = (key: string) => registry.defaultState(key as `block:${string}`);
const STONE = S('block:stone');
const DIRT = S('block:dirt');
const WATER = S('block:fresh_water');
const GRASS_PLANT = S('block:tall_grass');
const GLASS = S('block:glass');
const FOLIAGE = S('block:foliage');

const FILL: PaddedFill = {
  belowBlock: S('block:worldrock'),
  missingBlock: registry.air,
  missingLight: 0xf0,
  air: registry.air,
};

function mesh(build: (world: VoxelWorld) => void, sy = 2, greedy = true): SectionMesh {
  const world = new VoxelWorld(registry.air, S('block:worldrock'));
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) world.ensureColumn(cx, cz);
  build(world);
  const padded = createPadded();
  fillPadded(world, 0, sy, 0, FILL, padded);
  return meshSection(padded, registry.tables, { greedy });
}

const quadCount = (m: SectionMesh) => m.passes.reduce((sum, p) => sum + p.quads, 0);
const BASE = 64; // world y of the section sy = 2

describe('vertex format', () => {
  it('packs and unpacks every field', () => {
    const v = unpackVertex(packW0(512, 16, 300, 2), packW1(255, 5, 60, 33, 17, 5));
    expect(v).toEqual({
      x: 32,
      y: 1,
      z: 18.75,
      ao: 2,
      layer: 255,
      face: 5,
      sky: 60,
      block: 33,
      tint: 17,
      flags: 5,
    });
  });
});

describe('section mesher', () => {
  it('meshes a lone cube as 6 quads', () => {
    expect(quadCount(mesh((w) => w.setBlock(5, BASE + 5, 5, STONE)))).toBe(6);
  });

  it('merges a full 32×1×32 slab into 6 quads', () => {
    const m = mesh((w) => {
      for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) w.setBlock(x, BASE + 4, z, STONE);
    });
    expect(quadCount(m)).toBe(6);
  });

  it('does not merge two different blocks (10 quads)', () => {
    const m = mesh((w) => {
      w.setBlock(5, BASE + 5, 5, STONE);
      w.setBlock(6, BASE + 5, 5, DIRT);
    });
    expect(quadCount(m)).toBe(10);
  });

  it('darkens the corner next to an L-shaped neighbour (ambient occlusion)', () => {
    const m = mesh((w) => {
      w.setBlock(5, BASE + 5, 5, STONE);
      w.setBlock(6, BASE + 6, 5, STONE); // above-east of the first cube
    });
    const top = vertices(m).filter((v) => v.face === 2 && v.y === 6 && v.x <= 6 && v.z <= 6);
    const nearWall = top.filter((v) => v.x === 6);
    const farSide = top.filter((v) => v.x === 5);
    expect(nearWall.every((v) => v.ao < 3)).toBe(true);
    expect(farSide.every((v) => v.ao === 3)).toBe(true);
  });

  it('flips the quad diagonal towards the brighter corners', () => {
    const m = mesh((w) => {
      w.setBlock(5, BASE + 5, 5, STONE);
      w.setBlock(4, BASE + 6, 4, STONE); // only the (−x, −z) corner of the top face is occluded
    });
    const quad = quads(m).find(
      (q) => q[0]!.face === 2 && q.every((v) => v.y === 6 && v.x >= 5 && v.z >= 5),
    )!;
    // Vertices 0 and 2 form the shared diagonal: it must avoid the dark corner.
    const dark = quad.findIndex((v) => v.ao < 3);
    expect(dark === 1 || dark === 3).toBe(true);
  });

  it('hides faces between water blocks and between glass blocks', () => {
    const water = mesh((w) => {
      w.setBlock(5, BASE + 5, 5, WATER);
      w.setBlock(6, BASE + 5, 5, WATER);
    });
    // 4 sides each + the two lowered surfaces merged into one quad; nothing between them.
    expect(water.passes[2].quads).toBe(9);
    const glass = mesh((w) => {
      w.setBlock(5, BASE + 5, 5, GLASS);
      w.setBlock(6, BASE + 5, 5, GLASS);
    });
    expect(glass.passes[1].quads).toBe(6);
  });

  it('emits cross plants as 2 quads in the cutout pass', () => {
    const m = mesh((w) => w.setBlock(5, BASE + 5, 5, GRASS_PLANT));
    expect(m.passes[1].quads).toBe(2);
    expect(m.passes[0].quads).toBe(0);
  });

  it('sends foliage to the cutout pass and stone to the opaque pass', () => {
    const m = mesh((w) => {
      w.setBlock(2, BASE + 2, 2, FOLIAGE);
      w.setBlock(9, BASE + 2, 2, STONE);
    });
    expect(m.passes[0].quads).toBe(6);
    expect(m.passes[1].quads).toBe(6);
  });

  it('gives identical per-face results with and without greedy merging', () => {
    for (let seed = 0; seed < 6; seed++) {
      const build = (w: VoxelWorld) => randomSection(w, seed);
      const merged = unitFaces(mesh(build, 2, true));
      const plain = unitFaces(mesh(build, 2, false));
      expect(merged.length).toBe(plain.length);
      expect(merged).toEqual(plain);
    }
  });

  it('reports connectivity between open faces', () => {
    const open = mesh(() => {});
    expect(open.connectivity).toBe((1 << 15) - 1);
    const wall = mesh((w) => {
      for (let y = 0; y < 32; y++) for (let z = 0; z < 32; z++) w.setBlock(16, BASE + y, z, STONE);
    });
    expect(wall.connectivity & (1 << pairBit(0, 1))).toBe(0);
    expect(wall.connectivity & (1 << pairBit(2, 3))).not.toBe(0);
  });
});

type V = ReturnType<typeof unpackVertex>;

function vertices(m: SectionMesh): V[] {
  const out: V[] = [];
  for (const pass of m.passes) {
    for (let i = 0; i < pass.quads * 4; i++)
      out.push(unpackVertex(pass.data[i * 2]!, pass.data[i * 2 + 1]!));
  }
  return out;
}

function quads(m: SectionMesh): V[][] {
  const all = vertices(m);
  const out: V[][] = [];
  for (let i = 0; i < all.length; i += 4) out.push(all.slice(i, i + 4));
  return out;
}

/** Random blocks and random light, built from a seeded generator. */
function randomSection(world: VoxelWorld, seed: number): void {
  const rng = Rng.fromSeed(`mesh-${seed}`, 'blocks');
  const palette = [STONE, STONE, DIRT, GLASS, FOLIAGE];
  for (let i = 0; i < 2500; i++) {
    const x = rng.int(32);
    const y = rng.int(32);
    const z = rng.int(32);
    world.setBlock(x, BASE + y, z, palette[rng.int(palette.length)]!);
  }
  for (let x = 0; x < 32; x++) {
    for (let z = 0; z < 32; z++) {
      for (let y = 0; y < 32; y++) {
        if (rng.chance(0.3)) world.setLight(x, BASE + y, z, (rng.int(16) << 4) | rng.int(16));
      }
    }
  }
  void localIndex;
}

/**
 * Expands every quad into unit faces with the values at each canonical corner, so meshes with and
 * without merging can be compared cell by cell.
 */
function unitFaces(m: SectionMesh): string[] {
  const out: string[] = [];
  for (const quad of quads(m)) {
    const face = quad[0]!.face;
    if (face > 5) continue;
    const axis = [0, 0, 1, 1, 2, 2][face]!;
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const coord = (vx: V, a: number) => [vx.x, vx.y, vx.z][a]!;
    const us = quad.map((q) => coord(q, u));
    const vs = quad.map((q) => coord(q, v));
    const u0 = Math.min(...us);
    const u1 = Math.max(...us);
    const v0 = Math.min(...vs);
    const v1 = Math.max(...vs);
    const corner = (cu: number, cv: number) =>
      quad.find((q) => coord(q, u) === cu && coord(q, v) === cv)!;
    const c = [corner(u0, v0), corner(u1, v0), corner(u1, v1), corner(u0, v1)];
    const values = c.map((q) => `${q.ao}/${q.sky}/${q.block}`).join(',');
    const plane = coord(quad[0]!, axis);
    for (let uu = u0; uu < u1; uu++) {
      for (let vv = v0; vv < v1; vv++) {
        out.push(
          `${face}|${plane}|${uu}|${vv}|${quad[0]!.layer}|${quad[0]!.tint}|${quad[0]!.flags}|${values}`,
        );
      }
    }
  }
  return out.sort();
}

describe('mesher review fixes', () => {
  it('tints only the tint-aware faces of a grass block (dirt underside stays untinted)', () => {
    const grass = S('block:grass');
    const m = mesh((w) => w.setBlock(5, BASE + 5, 5, grass));
    const byFace = new Map(vertices(m).map((v) => [v.face, v.tint]));
    expect(byFace.get(2)).toBe(1); // top
    expect(byFace.get(0)).toBe(1); // side (tint mask)
    expect(byFace.get(3)).toBe(0); // bottom: plain dirt texture
  });

  it('merges a flat water surface into one lowered quad', () => {
    const m = mesh((w) => {
      for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) w.setBlock(x, BASE + 4, z, WATER);
    });
    const tops = quads(m).filter((q) => q[0]!.face === 2);
    expect(tops).toHaveLength(1);
    expect(tops[0]!.every((v) => v.y === 5 - 2 / 16)).toBe(true);
  });

  it('gives the same unit faces with and without merging when water is present', () => {
    for (let seed = 10; seed < 14; seed++) {
      const build = (w: VoxelWorld) => {
        randomSection(w, seed);
        for (let x = 0; x < 32; x++)
          for (let z = 0; z < 32; z++)
            if ((x * 7 + z * 3 + seed) % 5 === 0) w.setBlock(x, BASE + 20, z, WATER);
      };
      expect(unitFaces(mesh(build, 2, true))).toEqual(unitFaces(mesh(build, 2, false)));
    }
  });

  it('flips liquid side diagonals away from the occluded corner', () => {
    const m = mesh((w) => {
      w.setBlock(5, BASE + 5, 5, WATER);
      w.setBlock(4, BASE + 4, 6, STONE); // occludes only the lower-west corner of the south face
    });
    const south = quads(m).find((q) => q[0]!.face === 4 && q.every((v) => v.z === 6))!;
    const dark = south.findIndex((v) => v.ao < 3);
    expect(dark === 1 || dark === 3).toBe(true);
  });
});
