import {
  Color,
  type DataArrayTexture,
  Fog,
  Group,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderTarget,
} from 'three';
import { ChunkMeshes } from './ChunkMeshes.ts';
import type { HandView } from './HandView.ts';
import type { Renderer } from './Renderer.ts';
import { Sky } from './Sky.ts';
import { createVoxelMaterials, type DebugView, type VoxelMaterials } from './voxelMaterial.ts';

export interface CameraPose {
  x: number;
  y: number;
  z: number;
  /** Radians around +y; 0 looks north (−z). */
  yaw: number;
  /** Radians, positive looks up. */
  pitch: number;
}

export interface CaptureStats {
  readonly width: number;
  readonly height: number;
  readonly avgLuma: number;
  readonly uniqueColors: number;
}

const HORIZON = '#a9c8e2';
const ZENITH = '#4f86c6';

/** Scene, camera and chunk meshes of the voxel world. */
export class WorldView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(75, 1, 0.05, 400);
  readonly chunks: ChunkMeshes;
  readonly materials: VoxelMaterials;
  private readonly renderer: Renderer;
  private readonly chunkRoot = new Group();
  private readonly sky = new Sky(ZENITH, HORIZON);
  private readonly fog: Fog;
  private hand: HandView | null = null;
  private elapsed = 0;

  constructor(
    renderer: Renderer,
    textures: DataArrayTexture,
    tintColors: readonly string[],
    renderDistance: number,
  ) {
    this.renderer = renderer;
    this.materials = createVoxelMaterials(textures, tintColors);
    this.chunks = new ChunkMeshes(this.chunkRoot, this.materials);
    this.scene.add(this.chunkRoot, this.sky.mesh);
    this.scene.background = new Color(HORIZON);
    this.fog = new Fog(HORIZON, 0, 1);
    this.scene.fog = this.fog;
    this.setRenderDistance(renderDistance);
    this.camera.rotation.order = 'YXZ';
    renderer.setResizeHandler((width, height) => {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      if (this.hand) {
        this.hand.camera.aspect = width / height;
        this.hand.camera.updateProjectionMatrix();
      }
    });
  }

  /** The first-person hand view, drawn after the world on a cleared depth buffer when visible. */
  attachHand(hand: HandView): void {
    this.hand = hand;
    hand.camera.aspect = this.camera.aspect;
    hand.camera.updateProjectionMatrix();
  }

  /** Fog and far plane follow the render distance (in columns). */
  setRenderDistance(renderDistance: number): void {
    const reach = renderDistance * 32;
    this.fog.near = reach * 0.55;
    this.fog.far = reach - 8;
    this.camera.far = reach + 48;
    this.camera.updateProjectionMatrix();
  }

  setPose(pose: CameraPose): void {
    this.camera.position.set(pose.x, pose.y, pose.z);
    this.camera.rotation.set(pose.pitch, pose.yaw, 0);
  }

  setDebugView(view: DebugView): void {
    this.materials.setDebugView(view);
  }

  frame(dt: number): void {
    this.elapsed += dt;
    this.materials.uniforms.uTime.value = this.elapsed % 3600;
    this.sky.follow(this.camera.position.x, this.camera.position.y, this.camera.position.z);
    const webgl = this.renderer.webgl;
    webgl.info.reset();
    webgl.render(this.scene, this.camera);
    const hand = this.hand;
    if (hand?.visible && hand.batch.size > 0) {
      webgl.autoClear = false;
      webgl.clearDepth();
      webgl.render(hand.scene, hand.camera);
      webgl.autoClear = true;
    }
  }

  /** Renders the current view into a small target and returns colour statistics. */
  capture(width = 256, height = 144): CaptureStats {
    const webgl = this.renderer.webgl;
    const target = new WebGLRenderTarget(width, height);
    target.texture.colorSpace = SRGBColorSpace;
    const aspect = this.camera.aspect;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    webgl.setRenderTarget(target);
    webgl.render(this.scene, this.camera);
    const pixels = new Uint8Array(width * height * 4);
    webgl.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    webgl.setRenderTarget(null);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    target.dispose();
    let luma = 0;
    const colors = new Set<number>();
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
    }
    return { width, height, avgLuma: luma / (width * height) / 255, uniqueColors: colors.size };
  }

  dispose(): void {
    this.sky.dispose();
    this.chunks.clear();
    this.materials.dispose();
  }
}
