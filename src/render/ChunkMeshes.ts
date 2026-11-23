import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  type Group,
  Mesh,
  type ShaderMaterial,
  Sphere,
  Vector3,
} from 'three';
import type { SectionMesh } from '../world/mesh/greedyMesher.ts';
import { QUAD_WORDS } from '../world/mesh/vertexFormat.ts';
import type { VoxelMaterials } from './voxelMaterial.ts';

/**
 * Quads covered by the shared index: one single-box shape in every cell (32³ × 6 faces).
 * A pass with more quads (multi-box shapes) is split into several meshes.
 */
export const MAX_QUADS = 196_608;
const RENDER_ORDER = [0, 1, 10] as const;
const SECTION_CENTER = new Vector3(16, 16, 16);
const SECTION_RADIUS = Math.sqrt(3) * 16;

/** One index buffer shared by every chunk geometry: quad i → 4i, 4i+1, 4i+2, 4i+2, 4i+3, 4i. */
function createQuadIndex(): BufferAttribute {
  const index = new Uint32Array(MAX_QUADS * 6);
  for (let q = 0, i = 0; q < MAX_QUADS; q++, i += 6) {
    const v = q * 4;
    index[i] = v;
    index[i + 1] = v + 1;
    index[i + 2] = v + 2;
    index[i + 3] = v + 2;
    index[i + 4] = v + 3;
    index[i + 5] = v;
  }
  return new BufferAttribute(index, 1);
}

interface SectionEntry {
  readonly meshes: Mesh[];
  quads: number;
  bytes: number;
}

/** GPU meshes of the world sections, three passes each. */
export class ChunkMeshes {
  private readonly root: Group;
  private readonly materials: readonly ShaderMaterial[];
  private readonly index = createQuadIndex();
  private readonly sections = new Map<number, SectionEntry>();

  constructor(root: Group, materials: VoxelMaterials) {
    this.root = root;
    this.materials = [materials.opaque, materials.cutout, materials.translucent];
  }

  /** Replaces the meshes of a section (origin in blocks). Empty passes get no mesh. */
  update(key: number, originX: number, originY: number, originZ: number, mesh: SectionMesh): void {
    this.remove(key);
    const entry: SectionEntry = { meshes: [], quads: 0, bytes: 0 };
    mesh.passes.forEach((pass, p) => {
      // Chunks of at most MAX_QUADS quads; slices start on a quad boundary (gl_VertexID & 3 stays valid).
      for (let first = 0; first < pass.quads; first += MAX_QUADS) {
        const quads = Math.min(MAX_QUADS, pass.quads - first);
        const data = pass.data.subarray(first * QUAD_WORDS, (first + quads) * QUAD_WORDS);
        const geometry = new BufferGeometry();
        geometry.setAttribute('aPacked', new BufferAttribute(data, 2));
        geometry.setIndex(this.index);
        geometry.setDrawRange(0, quads * 6);
        geometry.boundingSphere = new Sphere(SECTION_CENTER.clone(), SECTION_RADIUS);
        geometry.boundingBox = new Box3(new Vector3(0, 0, 0), new Vector3(32, 32, 32));
        const object = new Mesh(geometry, this.materials[p]!);
        object.position.set(originX, originY, originZ);
        object.matrixAutoUpdate = false;
        object.updateMatrix();
        object.renderOrder = RENDER_ORDER[p]!;
        this.root.add(object);
        entry.meshes.push(object);
      }
      entry.quads += pass.quads;
      entry.bytes += pass.data.byteLength;
    });
    if (entry.quads > 0) this.sections.set(key, entry);
  }

  remove(key: number): void {
    const entry = this.sections.get(key);
    if (!entry) return;
    for (const mesh of entry.meshes) {
      this.root.remove(mesh);
      // Detach the shared index first: dispose() would delete it for every other section.
      mesh.geometry.setIndex(null);
      mesh.geometry.dispose();
    }
    this.sections.delete(key);
  }

  clear(): void {
    for (const key of [...this.sections.keys()]) this.remove(key);
  }

  stats(): { sections: number; meshes: number; quads: number; geometryBytes: number } {
    let meshes = 0;
    let quads = 0;
    let bytes = 0;
    for (const entry of this.sections.values()) {
      meshes += entry.meshes.length;
      quads += entry.quads;
      bytes += entry.bytes;
    }
    return { sections: this.sections.size, meshes, quads, geometryBytes: bytes };
  }
}
