import {
  BoxGeometry,
  Color,
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
 * How a box is textured: texture-array layers of its sides, top and bottom with their tints, and
 * where the unit box sits in texture space (origin and size, in blocks: 0…1 is one texture).
 * `sprite` boxes are cut from an icon and sample its plane on every face.
 */
export interface BoxSkin {
  readonly side: number;
  readonly top: number;
  readonly bottom: number;
  /** Tints of the sides, top and bottom (`boxTint`; BOX_NO_TINT for none). */
  readonly sideTint: number;
  readonly topTint: number;
  readonly bottomTint: number;
  /**
   * The layers' alpha is coverage (cutout and translucent blocks, icons): texels under the cutout
   * threshold are holes and the tint covers the whole texel. Else alpha masks the tint, as in the
   * chunks' opaque pass.
   */
  readonly cutout: boolean;
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly sprite: boolean;
}

/** `boxTint` of white: no tint. */
export const BOX_NO_TINT = 0xffffff;

/**
 * A tint colour (sRGB hex) as the box shader reads it: linear RGB like the chunks' tint uniforms,
 * 8 bits a channel packed as 0xRRGGBB, which a float attribute holds exactly.
 */
export function boxTint(hex: string): number {
  const c = new Color(hex);
  return (Math.round(c.r * 255) << 16) | (Math.round(c.g * 255) << 8) | Math.round(c.b * 255);
}

/** One layer on every face, the whole texture on each (avatar parts). */
export function fullSkin(layer: number): BoxSkin {
  return {
    side: layer,
    top: layer,
    bottom: layer,
    sideTint: BOX_NO_TINT,
    topTint: BOX_NO_TINT,
    bottomTint: BOX_NO_TINT,
    cutout: false,
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
 * Every small box of a scene (avatar, creatures, item drops, held items, particles) in one
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
  private readonly tints: InstancedBufferAttribute;
  private readonly effects: InstancedBufferAttribute;
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
    this.tints = this.attribute(geometry, 'aTints', 4);
    this.effects = this.attribute(geometry, 'aFx', 2);
    const material = new ShaderMaterial({
      vertexShader: boxVertex,
      fragmentShader: boxFragment,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        uTextures: shared.uTextures,
        uDaylight: shared.uDaylight,
        uSkyTint: shared.uSkyTint,
        uTorchTint: shared.uTorchTint,
        uFlicker: shared.uFlicker,
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

  /** Boxes that still fit this frame (`add` drops any past the capacity). */
  get room(): number {
    return this.capacity - this.count;
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
   * `glow` 1 draws it at full brightness whatever the light (a creature's eyes); `flash` (0–1)
   * tints it red (a creature just hurt). Boxes past the capacity are dropped.
   */
  add(world: Matrix4, skin: BoxSkin, sky: number, block: number, glow = 0, flash = 0): void {
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
    this.tints.setXYZW(i, skin.sideTint, skin.topTint, skin.bottomTint, skin.cutout ? 1 : 0);
    this.effects.setXY(i, glow, flash);
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
    BoxBatch.upload(this.tints, this.count);
    BoxBatch.upload(this.effects, this.count);
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
