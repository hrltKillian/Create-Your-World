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
import { type SectionCoords, sectionKeyParts } from '../world/coords.ts';
import type { PassMesh, SectionMesh } from '../world/mesh/greedyMesher.ts';
import { QUAD_WORDS } from '../world/mesh/vertexFormat.ts';
import { Occlusion } from './Occlusion.ts';
import type { VoxelMaterials } from './voxelMaterial.ts';

/**
 * Quads covered by the shared index: one single-box shape in every cell (32³ × 6 faces).
 * A pass with more quads (multi-box shapes) is split into several meshes.
 */
export const MAX_QUADS = 196_608;
const RENDER_ORDER = [0, 1, 10] as const;
const SECTION_CENTER = new Vector3(16, 16, 16);
const SECTION_RADIUS = Math.sqrt(3) * 16;
/** Coordinates decoded from a section key. */
const at: SectionCoords = { cx: 0, sy: 0, cz: 0 };

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

/** Smallest power of two ≥ n (n ≥ 1): the capacity of a replaced vertex array. */
export function capacityFor(n: number): number {
  let capacity = 1;
  while (capacity < n) capacity *= 2;
  return capacity;
}

interface SectionEntry {
  readonly cx: number;
  readonly sy: number;
  readonly cz: number;
  /** Meshes of each pass (opaque, cutout, translucent); a pass over MAX_QUADS quads has several. */
  readonly passes: readonly [Mesh[], Mesh[], Mesh[]];
  quads: number;
  /** Bytes of the vertex arrays (their capacity: what the GPU holds). */
  bytes: number;
}

export interface ChunkStats {
  readonly sections: number;
  readonly meshes: number;
  readonly quads: number;
  readonly geometryBytes: number;
  /** Remeshes written into the vertex buffer already there (no new geometry). */
  readonly inPlace: number;
  /** Sections the cave culling hides after its last walk. */
  readonly hidden: number;
}

/**
 * GPU meshes of the world sections, three passes each, and what the cave culling needs of them:
 * each section's connectivity mask (`Occlusion`), and their `visible` flags after each walk.
 *
 * A remesh whose data fits the vertex buffer already there is written into it (`array.set` and an
 * update range: three uploads that range and keeps the geometry); otherwise the pass gets a new
 * geometry. A pass's first mesh keeps the worker's array as it is (exact size, no copy); a
 * replacement gets a power-of-two capacity, so the next edits of that section fit.
 */
export class ChunkMeshes {
  readonly occlusion = new Occlusion();
  private readonly root: Group;
  private readonly materials: readonly ShaderMaterial[];
  private readonly index = createQuadIndex();
  private readonly sections = new Map<number, SectionEntry>();
  /** Connectivity of the sections whose mesh is current (none: fully connected). */
  private readonly masks = new Map<number, number>();
  private inPlace = 0;
  private hidden = 0;

  /** Applies the last walk to one section (a bound callback: `forEach` allocates nothing). */
  private readonly applyVisibility = (entry: SectionEntry): void => {
    const visible = this.occlusion.visible(entry.cx, entry.sy, entry.cz);
    if (!visible) this.hidden++;
    for (const meshes of entry.passes) for (const mesh of meshes) mesh.visible = visible;
  };

  constructor(root: Group, materials: VoxelMaterials) {
    this.root = root;
    this.materials = [materials.opaque, materials.cutout, materials.translucent];
  }

  /** Replaces the meshes of a section (origin in blocks) and its mask. Empty passes get no mesh. */
  update(key: number, originX: number, originY: number, originZ: number, mesh: SectionMesh): void {
    const cx = originX >> 5;
    const cz = originZ >> 5;
    const entry: SectionEntry = this.sections.get(key) ?? {
      cx,
      sy: originY >> 5,
      cz,
      passes: [[], [], []],
      quads: 0,
      bytes: 0,
    };
    entry.quads = 0;
    entry.bytes = 0;
    for (let p = 0; p < 3; p++)
      this.updatePass(entry, p, mesh.passes[p]!, originX, originY, originZ);
    if (entry.quads > 0) this.sections.set(key, entry);
    else this.sections.delete(key);
    this.setMask(key, cx, cz, mesh.connectivity);
  }

  /** Removes a section's meshes; it counts as fully connected again (empty, or gone). */
  remove(key: number): void {
    const entry = this.sections.get(key);
    if (entry) {
      for (const meshes of entry.passes) this.disposeAll(meshes);
      this.sections.delete(key);
    }
    this.forgetMask(key);
  }

  /**
   * The section's data changed and a new mesh is on its way: until it arrives the section counts
   * as fully connected (its old mesh stays on screen).
   */
  outdated(key: number): void {
    this.forgetMask(key);
  }

  clear(): void {
    for (const key of [...this.sections.keys()]) this.remove(key);
    this.masks.clear();
  }

  /**
   * Cave culling before a frame: walks again when needed (camera at x, y, z), then sets the
   * meshes' `visible` flags. At most one walk per call.
   */
  cull(x: number, y: number, z: number, renderDistance: number): void {
    if (!this.occlusion.update(x, y, z, renderDistance, this.masks)) return;
    this.hidden = 0;
    this.sections.forEach(this.applyVisibility);
  }

  stats(): ChunkStats {
    let meshes = 0;
    let quads = 0;
    let bytes = 0;
    for (const entry of this.sections.values()) {
      for (const pass of entry.passes) meshes += pass.length;
      quads += entry.quads;
      bytes += entry.bytes;
    }
    return {
      sections: this.sections.size,
      meshes,
      quads,
      geometryBytes: bytes,
      inPlace: this.inPlace,
      hidden: this.hidden,
    };
  }

  /** One pass of a section: written in place when it fits, else new meshes (none when empty). */
  private updatePass(
    entry: SectionEntry,
    p: number,
    pass: PassMesh,
    originX: number,
    originY: number,
    originZ: number,
  ): void {
    const meshes = entry.passes[p]!;
    const bytes = this.writeInPlace(meshes, pass);
    if (bytes > 0) {
      this.inPlace++;
      entry.bytes += bytes;
    } else {
      const replacing = meshes.length > 0;
      this.disposeAll(meshes);
      // New meshes start as the last walk left their section (the next walk may change it).
      const visible = this.occlusion.visible(entry.cx, entry.sy, entry.cz);
      // Chunks of at most MAX_QUADS quads; slices start on a quad boundary (gl_VertexID & 3 stays valid).
      for (let first = 0; first < pass.quads; first += MAX_QUADS) {
        const quads = Math.min(MAX_QUADS, pass.quads - first);
        const slice = pass.data.subarray(first * QUAD_WORDS, (first + quads) * QUAD_WORDS);
        const data = replacing ? withCapacity(slice) : slice;
        const mesh = this.createMesh(p, data, quads, originX, originY, originZ);
        mesh.visible = visible;
        meshes.push(mesh);
        entry.bytes += data.byteLength;
      }
    }
    entry.quads += pass.quads;
  }

  /**
   * Writes a pass into its one mesh when the data fits its vertex array: three uploads only the
   * written range. Returns the array's bytes, or 0 when it does not fit (or the pass is empty).
   */
  private writeInPlace(meshes: readonly Mesh[], pass: PassMesh): number {
    if (meshes.length !== 1 || pass.quads === 0 || pass.quads > MAX_QUADS) return 0;
    const geometry = meshes[0]!.geometry;
    const attribute = geometry.getAttribute('aPacked') as BufferAttribute;
    const words = pass.quads * QUAD_WORDS;
    const array = attribute.array as Uint32Array;
    if (words > array.length) return 0;
    array.set(pass.data.subarray(0, words));
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, words);
    attribute.needsUpdate = true;
    geometry.setDrawRange(0, pass.quads * 6);
    return array.byteLength;
  }

  private createMesh(
    p: number,
    data: Uint32Array,
    quads: number,
    originX: number,
    originY: number,
    originZ: number,
  ): Mesh {
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
    return object;
  }

  /** Takes the meshes out of the scene and frees their geometry (the list is emptied). */
  private disposeAll(meshes: Mesh[]): void {
    for (const mesh of meshes) {
      this.root.remove(mesh);
      // Detach the shared index first: dispose() would delete it for every other section.
      mesh.geometry.setIndex(null);
      mesh.geometry.dispose();
    }
    meshes.length = 0;
  }

  private setMask(key: number, cx: number, cz: number, mask: number): void {
    if (this.masks.get(key) === mask) return;
    this.masks.set(key, mask);
    this.occlusion.changed(cx, cz);
  }

  private forgetMask(key: number): void {
    if (!this.masks.delete(key)) return;
    const { cx, cz } = sectionKeyParts(key, at);
    this.occlusion.changed(cx, cz);
  }
}

/** A copy of `data` in an array of power-of-two length (room for the next edits). */
function withCapacity(data: Uint32Array): Uint32Array {
  const sized = new Uint32Array(capacityFor(data.length));
  sized.set(data);
  return sized;
}
