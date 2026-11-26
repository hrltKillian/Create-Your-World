import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { FLAG_SOLID, type RawTables } from '../content/rawTables.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';

/**
 * Contact shadows (plan v4 « M41 »): a soft dark disc on the ground under each creature, drop and
 * the avatar, so they stand on it rather than float, fading as they rise above it. One instanced
 * draw of flat quads (transparent, never writing depth, pulled towards the camera against
 * z-fighting).
 */

/** Discs at most a frame, how far down the ground is looked for (blocks), and their darkness. */
export const MAX_CONTACT_SHADOWS = 160;
const REACH_DOWN = 3;
const DARKNESS = 0.45;
/** Just above the ground's top, so the disc lies on it. */
const LIFT = 0.02;

const vertex = /* glsl */ `
in float aShade;
out vec2 vUv;
out float vShade;

void main() {
  vUv = uv * 2.0 - 1.0;
  vShade = aShade;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const fragment = /* glsl */ `
in vec2 vUv;
in float vShade;

void main() {
  float r = dot(vUv, vUv);
  float a = (1.0 - smoothstep(0.2, 1.0, r)) * vShade;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;

export class ContactShadows {
  readonly mesh: InstancedMesh;
  private readonly shade: InstancedBufferAttribute;
  private readonly world: VoxelWorld;
  private readonly tables: RawTables;
  private readonly matrix = new Matrix4();
  private count = 0;

  constructor(world: VoxelWorld, tables: RawTables) {
    this.world = world;
    this.tables = tables;
    const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.shade = new InstancedBufferAttribute(new Float32Array(MAX_CONTACT_SHADOWS), 1);
    this.shade.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aShade', this.shade);
    const material = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    this.mesh = new InstancedMesh(geometry, material, MAX_CONTACT_SHADOWS);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
  }

  /** Discs added since `begin`. */
  get size(): number {
    return this.count;
  }

  begin(): void {
    this.count = 0;
  }

  /**
   * A disc of `radius` blocks under feet at (x, y, z): on the top of the first solid block within
   * REACH_DOWN below, darker the nearer the feet; none without ground.
   */
  add(x: number, y: number, z: number, radius: number): void {
    if (this.count >= MAX_CONTACT_SHADOWS) return;
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    const top = Math.floor(y - 0.01);
    for (let by = top; by > top - REACH_DOWN; by--) {
      const state = this.world.getBlock(bx, by, bz);
      if ((this.tables.flags[state]! & FLAG_SOLID) === 0) continue;
      const ground = by + 1;
      const fade = 1 - Math.min(1, Math.max(0, y - ground) / REACH_DOWN);
      const size = radius * 2 * (1 + 0.3 * (1 - fade));
      const i = this.count++;
      this.matrix.makeScale(size, 1, size).setPosition(x, ground + LIFT, z);
      this.mesh.setMatrixAt(i, this.matrix);
      this.shade.setX(i, DARKNESS * fade);
      return;
    }
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shade.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}
