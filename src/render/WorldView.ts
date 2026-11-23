import {
  BufferGeometry,
  Color,
  type DataArrayTexture,
  Fog,
  Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderTarget,
} from 'three';
import { ChunkMeshes } from './ChunkMeshes.ts';
import type { HandView } from './HandView.ts';
import type { Renderer } from './Renderer.ts';
import { Sky } from './Sky.ts';
import {
  createVoxelMaterials,
  type DebugView,
  torchFlicker,
  type VoxelMaterials,
} from './voxelMaterial.ts';

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

/** Underwater fog (docs « Ciel et brouillard »): blue, from 1 to 20 blocks. */
const WATER_FOG = new Color('#1f4f78');
const WATER_FOG_NEAR = 1;
const WATER_FOG_FAR = 20;

/** Scene, camera and chunk meshes of the voxel world. */
export class WorldView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(75, 1, 0.05, 400);
  readonly chunks: ChunkMeshes;
  readonly materials: VoxelMaterials;
  private readonly renderer: Renderer;
  private readonly chunkRoot = new Group();
  private readonly sky = new Sky();
  /** Clear colour: the fog colour, so the far edge of the world melts into it. */
  private readonly background = new Color();
  private readonly fog = new Fog(0, 0, 1);
  /** Fog range of the render distance (above water). */
  private fogNear = 0;
  private fogFar = 1;
  /** Hour of the day shown: noon until a world clock sets it (`setTime`). */
  private hour = 12;
  private underwater = false;
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
    this.scene.background = this.background;
    this.scene.fog = this.fog;
    this.setRenderDistance(renderDistance);
    this.updateSky();
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
  attachHand(hand: HandView | null): void {
    this.hand = hand;
    if (!hand) return;
    hand.camera.aspect = this.camera.aspect;
    hand.camera.updateProjectionMatrix();
  }

  /** Vertical field of view of the world camera, in degrees (Settings). */
  setFov(degrees: number): void {
    this.camera.fov = degrees;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Compiles every shader program of play while loading (docs/conception.md « Précompilation »),
   * so nothing stalls a frame on first use: one probe mesh per chunk material joins the scene
   * for the call, then the world and hand scenes are compiled. three compiles every object of a
   * scene, shown or not, so the hidden overlays (outline, crack, ghost) and the empty box batches
   * need no probe. `compileAsync` compiles synchronously, then waits for the driver.
   */
  async precompile(): Promise<void> {
    const webgl = this.renderer.webgl;
    const m = this.materials;
    const geometry = new BufferGeometry();
    const probes = [m.opaque, m.cutout, m.translucent].map(
      (material) => new Mesh(geometry, material),
    );
    this.chunkRoot.add(...probes);
    const world = webgl.compileAsync(this.scene, this.camera);
    this.chunkRoot.remove(...probes);
    geometry.dispose();
    const hand = this.hand ? webgl.compileAsync(this.hand.scene, this.hand.camera) : null;
    await Promise.all([world, hand]);
  }

  /** Fog and far plane follow the render distance (in columns). */
  setRenderDistance(renderDistance: number): void {
    const reach = renderDistance * 32;
    this.fogNear = reach * 0.55;
    this.fogFar = reach - 8;
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

  /**
   * Time of day: the sky palette, sun, moon and stars follow `hour` (0 ≤ hour < 24), and sky light
   * is scaled by `daylight` in the shaders (the world is never re-lit).
   */
  setTime(hour: number, daylight: number): void {
    this.hour = hour;
    this.materials.uniforms.uDaylight.value = daylight;
  }

  /** The camera is inside a liquid: short blue fog and no sky. */
  setUnderwater(underwater: boolean): void {
    this.underwater = underwater;
  }

  frame(dt: number): void {
    this.elapsed += dt;
    const uniforms = this.materials.uniforms;
    uniforms.uTime.value = this.elapsed % 3600;
    uniforms.uFlicker.value = torchFlicker(this.elapsed);
    this.updateSky();
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

  /** Sky, sky light tint, fog and clear colour for the hour, or the underwater fog. */
  private updateSky(): void {
    const sky = this.sky;
    const uniforms = this.materials.uniforms;
    sky.update(this.hour);
    uniforms.uSkyTint.value.copy(sky.colors.light);
    const fog = this.fog;
    if (this.underwater) {
      // Darker water at night, never black.
      fog.color.copy(WATER_FOG).multiplyScalar(0.2 + 0.8 * uniforms.uDaylight.value);
      fog.near = WATER_FOG_NEAR;
      fog.far = WATER_FOG_FAR;
    } else {
      fog.color.copy(sky.colors.horizon);
      fog.near = this.fogNear;
      fog.far = this.fogFar;
    }
    sky.mesh.visible = !this.underwater;
    this.background.copy(fog.color);
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
