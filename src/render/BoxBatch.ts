import {
  BoxGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  type Matrix4,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
} from 'three';
import { boxFragment, boxVertex } from './shaders/box.glsl.ts';
import type { VoxelUniforms } from './voxelMaterial.ts';

/**
 * How a box is textured: texture-array layers of its sides, top and bottom, and where the unit box
 * sits in texture space (origin and size, in blocks: 0…1 is one texture). `sprite` boxes are cut
 * from an icon and sample its plane on every face.
 */
export interface BoxSkin {
  readonly side: number;
  readonly top: number;
  readonly bottom: number;
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly sprite: boolean;
}

/** One layer on every face, the whole texture on each (avatar parts). */
export function fullSkin(layer: number): BoxSkin {
  return {
    side: layer,
    top: layer,
    bottom: layer,
    ox: 0,
    oy: 0,
    oz: 0,
    sx: 1,
    sy: 1,
    sz: 1,
    sprite: false,
  };
}

/** Instances of the world batch (spec capacity) and of the small hand-view batch. */
export const WORLD_BOXES = 8192;
export const HAND_BOXES = 64;

/**
 * Every small box of a scene (avatar, item drops, held items, particles, later creatures) in one
 * InstancedMesh: one draw call. Instance transforms are written relative to an origin near the
 * camera, so far from the world centre Float32 matrices keep their precision. Instances are
 * rewritten every frame and only the written range is uploaded.
 */
export class BoxBatch {
  readonly mesh: InstancedMesh;
  private readonly layers: InstancedBufferAttribute;
  private readonly lights: InstancedBufferAttribute;
  private readonly texOrigins: InstancedBufferAttribute;
  private readonly texSizes: InstancedBufferAttribute;
  private readonly capacity: number;
  private count = 0;
  private originX = 0;
  private originY = 0;
  private originZ = 0;

  /** `fog`: false for the hand view, whose scene has none (a separate material and program). */
  constructor(shared: VoxelUniforms, capacity: number, fog: boolean) {
    this.capacity = capacity;
    const geometry = new BoxGeometry(1, 1, 1);
    geometry.translate(0.5, 0.5, 0.5);
    this.layers = this.attribute(geometry, 'aLayers', 3);
    this.lights = this.attribute(geometry, 'aLight', 2);
    this.texOrigins = this.attribute(geometry, 'aTexOrigin', 4);
    this.texSizes = this.attribute(geometry, 'aTexSize', 3);
    const material = new ShaderMaterial({
      vertexShader: boxVertex,
      fragmentShader: boxFragment,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        uTextures: shared.uTextures,
        uDaylight: shared.uDaylight,
        uSkyTint: shared.uSkyTint,
        uTorchTint: shared.uTorchTint,
        uMinLight: shared.uMinLight,
      },
      fog,
    });
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
  }

  /** Boxes written since `begin`. */
  get size(): number {
    return this.count;
  }

  /** Starts a frame: instances are positioned relative to (x, y, z), usually the camera section. */
  begin(x: number, y: number, z: number): void {
    this.count = 0;
    this.originX = x;
    this.originY = y;
    this.originZ = z;
    this.mesh.position.set(x, y, z);
    this.mesh.updateMatrix();
  }

  /**
   * Adds a unit box given its world matrix (absolute coordinates), skin and light (0–1 each).
   * Boxes past the capacity are dropped.
   */
  add(world: Matrix4, skin: BoxSkin, sky: number, block: number): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const e = world.elements;
    const o = i * 16;
    for (let k = 0; k < 12; k++) m[o + k] = e[k]!;
    m[o + 12] = e[12]! - this.originX;
    m[o + 13] = e[13]! - this.originY;
    m[o + 14] = e[14]! - this.originZ;
    m[o + 15] = e[15]!;
    this.layers.setXYZ(i, skin.side, skin.top, skin.bottom);
    this.lights.setXY(i, sky, block);
    this.texOrigins.setXYZW(i, skin.ox, skin.oy, skin.oz, skin.sprite ? 1 : 0);
    this.texSizes.setXYZ(i, skin.sx, skin.sy, skin.sz);
  }

  /** Uploads only the instances written this frame. */
  end(): void {
    this.mesh.count = this.count;
    if (this.count === 0) return;
    BoxBatch.upload(this.mesh.instanceMatrix, this.count);
    BoxBatch.upload(this.layers, this.count);
    BoxBatch.upload(this.lights, this.count);
    BoxBatch.upload(this.texOrigins, this.count);
    BoxBatch.upload(this.texSizes, this.count);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }

  private attribute(geometry: BoxGeometry, name: string, size: number): InstancedBufferAttribute {
    const attribute = new InstancedBufferAttribute(new Float32Array(this.capacity * size), size);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
    return attribute;
  }

  private static upload(attribute: InstancedBufferAttribute, count: number): void {
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, count * attribute.itemSize);
    attribute.needsUpdate = true;
  }
}
