import {
  BoxGeometry,
  type DataArrayTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
} from 'three';
import { boxFragment, boxVertex } from './shaders/box.glsl.ts';
import type { VoxelUniforms } from './voxelMaterial.ts';

/**
 * Every small box of the scene (avatar, later creatures, drops, particles) in one InstancedMesh:
 * one draw call. Instance transforms are written relative to an origin near the camera, so far
 * from the world centre Float32 matrices keep their precision.
 */
export class BoxBatch {
  readonly mesh: InstancedMesh;
  private readonly layers: InstancedBufferAttribute;
  private readonly lights: InstancedBufferAttribute;
  private count = 0;
  private originX = 0;
  private originY = 0;
  private originZ = 0;
  private readonly tmp = new Matrix4();

  constructor(textures: DataArrayTexture, shared: VoxelUniforms, capacity = 2048) {
    const geometry = new BoxGeometry(1, 1, 1);
    geometry.translate(0.5, 0.5, 0.5);
    this.layers = new InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.lights = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    this.layers.setUsage(DynamicDrawUsage);
    this.lights.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aLayer', this.layers);
    geometry.setAttribute('aLight', this.lights);
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
      fog: true,
    });
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    void textures;
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

  /** Adds a box given its world matrix (absolute coordinates), layer and light (0–1 each). */
  add(world: Matrix4, layer: number, sky: number, block: number): void {
    if (this.count >= this.layers.count) return;
    const i = this.count++;
    this.tmp.copy(world);
    const e = this.tmp.elements;
    e[12] = e[12]! - this.originX;
    e[13] = e[13]! - this.originY;
    e[14] = e[14]! - this.originZ;
    this.mesh.setMatrixAt(i, this.tmp);
    this.layers.setX(i, layer);
    this.lights.setXY(i, sky, block);
  }

  /** Uploads only the instances written this frame. */
  end(): void {
    this.mesh.count = this.count;
    if (this.count === 0) return;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, this.count * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.layers.clearUpdateRanges();
    this.layers.addUpdateRange(0, this.count);
    this.layers.needsUpdate = true;
    this.lights.clearUpdateRanges();
    this.lights.addUpdateRange(0, this.count * 2);
    this.lights.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}
