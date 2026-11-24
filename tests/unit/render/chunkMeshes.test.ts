import type { BufferAttribute, Mesh, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { capacityFor } from '../../../src/render/ChunkMeshes.ts';
import { sectionKey } from '../../../src/world/coords.ts';
import type { SectionMesh } from '../../../src/world/mesh/greedyMesher.ts';
import { QUAD_WORDS } from '../../../src/world/mesh/vertexFormat.ts';
import { ALL_CONNECTED } from '../../../src/world/mesh/visibility.ts';
import { createTestWorldView } from '../../helpers/worldView.ts';

/** A section mesh with `quads` opaque quads (zeros: the content does not matter here). */
function sectionMesh(quads: number, connectivity = ALL_CONNECTED): SectionMesh {
  const pass = (n: number) => ({ data: new Uint32Array(n * QUAD_WORDS), quads: n });
  return { passes: [pass(quads), pass(0), pass(0)], connectivity };
}

function setup() {
  const { view } = createTestWorldView(4);
  const chunks = view.chunks;
  /** The chunk meshes in the scene (the sky dome is not a section). */
  const meshes = () =>
    (view.scene.children[0] as Object3D).children.filter((o): o is Mesh => (o as Mesh).isMesh);
  /** Section (cx, sy, cz)'s mesh(es) in the scene. */
  const at = (cx: number, sy: number, cz: number) =>
    meshes().filter(
      (m) => m.position.x === cx * 32 && m.position.y === sy * 32 && m.position.z === cz * 32,
    );
  const put = (cx: number, sy: number, cz: number, mesh: SectionMesh) =>
    chunks.update(sectionKey(cx, sy, cz), cx * 32, sy * 32, cz * 32, mesh);
  return { chunks, meshes, at, put };
}

const vertices = (mesh: Mesh) => mesh.geometry.getAttribute('aPacked') as BufferAttribute;

describe('chunk meshes', () => {
  it('writes a remesh that fits into the vertex buffer already there', () => {
    const { chunks, at, put } = setup();
    put(0, 2, 0, sectionMesh(10));
    const [first] = at(0, 2, 0);
    const array = vertices(first!).array;
    // A section's first mesh keeps the worker's array: exact size.
    expect(array.length).toBe(10 * QUAD_WORDS);
    put(0, 2, 0, sectionMesh(6));
    const [again] = at(0, 2, 0);
    expect(again).toBe(first);
    expect(vertices(again!).array).toBe(array);
    expect(vertices(again!).updateRanges).toEqual([{ start: 0, count: 6 * QUAD_WORDS }]);
    expect(again!.geometry.drawRange.count).toBe(36);
    expect(chunks.stats()).toMatchObject({ sections: 1, meshes: 1, quads: 6, inPlace: 1 });
  });

  it('gives a mesh that outgrows its buffer a new geometry of power-of-two capacity', () => {
    const { chunks, at, put } = setup();
    put(0, 2, 0, sectionMesh(10));
    const [first] = at(0, 2, 0);
    put(0, 2, 0, sectionMesh(20));
    const [grown] = at(0, 2, 0);
    expect(grown).not.toBe(first);
    // The replaced geometry was freed without the shared index (it serves every section).
    expect(first!.geometry.index).toBeNull();
    expect(grown!.geometry.index).not.toBeNull();
    const capacity = capacityFor(20 * QUAD_WORDS);
    expect(vertices(grown!).array.length).toBe(capacity);
    expect(chunks.stats().geometryBytes).toBe(capacity * 4);
    // The next edit fits.
    put(0, 2, 0, sectionMesh(capacity / QUAD_WORDS));
    expect(at(0, 2, 0)[0]).toBe(grown);
    expect(chunks.stats().inPlace).toBe(1);
  });

  it('drops the meshes of passes and sections that become empty', () => {
    const { chunks, at, put, meshes } = setup();
    put(0, 2, 0, sectionMesh(4));
    put(1, 2, 0, sectionMesh(4));
    const [gone] = at(0, 2, 0);
    put(0, 2, 0, sectionMesh(0));
    expect(at(0, 2, 0)).toEqual([]);
    expect(gone!.geometry.index).toBeNull();
    chunks.remove(sectionKey(1, 2, 0));
    expect(meshes()).toEqual([]);
    expect(chunks.stats()).toMatchObject({ sections: 0, meshes: 0, quads: 0, geometryBytes: 0 });
  });

  it('hides the sections the cave culling cannot reach, until a mask opens the way', () => {
    const { chunks, at, put } = setup();
    // The camera in section (0, 1, 0); solid rock above it, the surface higher up.
    put(0, 1, 0, sectionMesh(4, 0));
    put(0, 2, 0, sectionMesh(4, 0));
    for (let cx = -5; cx <= 5; cx++) {
      for (let cz = -5; cz <= 5; cz++) {
        if (cx !== 0 || cz !== 0) put(cx, 2, cz, sectionMesh(0, 0));
      }
    }
    put(0, 3, 0, sectionMesh(4));
    chunks.cull(16, 40, 16, 4);
    const [surface] = at(0, 3, 0);
    expect(surface!.visible).toBe(false);
    expect(at(0, 2, 0)[0]!.visible).toBe(true);
    expect(chunks.stats().hidden).toBe(1);
    // A new mesh of a hidden section (it outgrew its buffer) starts hidden.
    put(0, 3, 0, sectionMesh(40));
    const [grown] = at(0, 3, 0);
    expect(grown).not.toBe(surface);
    expect(grown!.visible).toBe(false);
    put(0, 3, 0, sectionMesh(4));
    // The rock above is being meshed again (an edit): it counts as connected meanwhile.
    chunks.outdated(sectionKey(0, 2, 0));
    chunks.cull(16, 40, 16, 4);
    const [shown] = at(0, 3, 0);
    expect(shown!.visible).toBe(true);
    // Its new mesh is still solid: hidden again. Then the culling is turned off.
    put(0, 2, 0, sectionMesh(4, 0));
    chunks.cull(16, 40, 16, 4);
    expect(shown!.visible).toBe(false);
    chunks.occlusion.setEnabled(false);
    chunks.cull(16, 40, 16, 4);
    expect(shown!.visible).toBe(true);
    expect(chunks.stats().hidden).toBe(0);
  });

  it('rounds capacities up to powers of two', () => {
    expect([1, 2, 3, 8, 9, 1000].map(capacityFor)).toEqual([1, 2, 4, 8, 16, 1024]);
  });
});
