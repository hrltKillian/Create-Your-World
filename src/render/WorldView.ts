import {
  BufferGeometry,
  Color,
  Fog,
  Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderTarget,
} from 'three';
import type { SkyDef } from '../content/skySchema.ts';
import { fnv1aBytes } from '../core/hash.ts';
import { Atmosphere, type WeatherLook } from './Atmosphere.ts';
import { Bloom } from './Bloom.ts';
import { ChunkMeshes } from './ChunkMeshes.ts';
import type { HandView } from './HandView.ts';
import { Lightning } from './Lightning.ts';
import { Precipitation } from './Precipitation.ts';
import type { Renderer } from './Renderer.ts';
import { SunShadow } from './SunShadow.ts';
import {
  createVoxelMaterials,
  type DebugView,
  type PackTextures,
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
  /** Radians around the view axis, positive leans left (a blow taken); 0 when absent. */
  roll?: number;
  /** Degrees added to the field of view setting (sprinting); 0 when absent. */
  fovOffset?: number;
}

export interface CaptureStats {
  readonly width: number;
  readonly height: number;
  readonly avgLuma: number;
  readonly uniqueColors: number;
  /** FNV-1a of the pixels: equal captures, an unchanged view (plan v4 « M38 »). */
  readonly hash: number;
}

/** Most anisotropic samples for the pack textures (decision 27: no shimmer far off, little cost). */
const ANISOTROPY = 4;

/** Scene, camera and chunk meshes of the voxel world. */
export class WorldView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(75, 1, 0.05, 400);
  readonly chunks: ChunkMeshes;
  readonly materials: VoxelMaterials;
  private readonly renderer: Renderer;
  private readonly chunkRoot = new Group();
  private readonly atmosphere: Atmosphere;
  /** Clear colour: the fog colour, so the far edge of the world melts into it. */
  private readonly background = new Color();
  private readonly fog = new Fog(0, 0, 1);
  /**
   * Horizontal reach of the render distance, RD·32 blocks: the fog ends 8 blocks short of it, and
   * creatures farther from the camera are not drawn (CreatureView).
   */
  reach = 0;
  /** Render distance in columns (the cave culling walks within it). */
  private renderDistance = 0;
  /** Fog range of the render distance (above water). */
  private fogNear = 0;
  private fogFar = 1;
  private underwater = false;
  /** The bloom passes (plan v4 « M40 »; null: off). */
  private bloom: Bloom | null = null;
  /** The sun's shadow map (null: shadows off). */
  private shadow: SunShadow | null = null;
  /** Rain and snow around the camera (filled by the client each frame). */
  readonly precipitation = new Precipitation();
  /** The last lightning bolt (plan v5 « M47 »: the client strikes it on a `lightning` event). */
  readonly lightning = new Lightning();
  private hand: HandView | null = null;
  private elapsed = 0;
  /** The field of view setting (degrees). */
  private fov = this.camera.fov;

  constructor(
    renderer: Renderer,
    textures: PackTextures,
    tintColors: readonly string[],
    renderDistance: number,
    sky?: SkyDef,
  ) {
    this.renderer = renderer;
    const anisotropy = Math.min(ANISOTROPY, renderer.webgl.capabilities.getMaxAnisotropy());
    textures.textures.anisotropy = anisotropy;
    textures.materials.anisotropy = anisotropy;
    this.materials = createVoxelMaterials(textures, tintColors);
    this.atmosphere = new Atmosphere(sky, this.materials.uniforms);
    this.chunks = new ChunkMeshes(this.chunkRoot, this.materials);
    const skyMesh = this.atmosphere.sky.mesh;
    this.scene.add(
      this.chunkRoot,
      skyMesh,
      this.precipitation.rain,
      this.precipitation.snow,
      this.lightning.mesh,
    );
    this.scene.background = this.background;
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
  attachHand(hand: HandView | null): void {
    this.hand = hand;
    if (!hand) return;
    hand.camera.aspect = this.camera.aspect;
    hand.camera.updateProjectionMatrix();
  }

  /** Vertical field of view of the world camera, in degrees (Settings; a pose may add to it). */
  /** The player's gamma (Settings, 0–1): lifts the dark end of the light curve. */
  setGamma(gamma: number): void {
    this.materials.uniforms.uGamma.value = gamma;
  }

  /** The sun's shadow map: `size` texels a side (decision 28: 1024 or 2048), 0 for none. */
  setShadows(size: number): void {
    if (size === (this.shadow?.size ?? 0)) return;
    const uniforms = this.materials.uniforms;
    this.shadow?.dispose();
    this.shadow = size > 0 ? new SunShadow(size, uniforms) : null;
    uniforms.uShadowMap.value = this.shadow?.texture ?? null;
    uniforms.uShadowTexel.value = this.shadow?.texel ?? 0;
    uniforms.uShadowMatrix.value = this.shadow?.matrix ?? uniforms.uShadowMatrix.value;
  }

  /** Bloom and the frame's multisampling (plan v4 « M40 », the high preset), on or off. */
  setBloom(on: boolean): void {
    if (on === (this.bloom !== null)) return;
    this.bloom?.dispose();
    this.bloom = on ? new Bloom() : null;
  }

  /** Whether bloom is on (`setBloom`). */
  get blooms(): boolean {
    return this.bloom !== null;
  }

  /** Draw calls of the last shadow pass (0 without shadows). */
  shadowDraws(): number {
    return this.shadow?.draws ?? 0;
  }

  /** The height the low ground's mist lies under (the world's sea level). */
  setMistLine(y: number): void {
    this.materials.uniforms.uMistLine.value = y;
  }

  setFov(degrees: number): void {
    this.fov = degrees;
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
    this.renderDistance = renderDistance;
    this.reach = reach;
    this.fogNear = reach * 0.55;
    this.fogFar = reach - 8;
    this.camera.far = reach + 48;
    this.camera.updateProjectionMatrix();
  }

  setPose(pose: CameraPose): void {
    this.camera.position.set(pose.x, pose.y, pose.z);
    this.camera.rotation.set(pose.pitch, pose.yaw, pose.roll ?? 0);
    const fov = this.fov + (pose.fovOffset ?? 0);
    if (fov !== this.camera.fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  setDebugView(view: DebugView): void {
    this.materials.setDebugView(view);
  }

  /**
   * Time of day: the sky palette, sun, moons and stars follow `hour` (0 ≤ hour < 24), the moons'
   * phases `days` into the world; sky light is scaled by `daylight` in the shaders (the world is
   * never re-lit).
   */
  setTime(hour: number, daylight: number, days = 0): void {
    this.atmosphere.setTime(hour, daylight, days);
  }

  /**
   * The weather shown (plan v3 « M34 »): clouds grey and darken the sky, fog closes in, a
   * lightning flash lights everything for a moment; `dim` scales the sky's light on the blocks.
   */
  setWeather(look: Readonly<WeatherLook>): void {
    this.atmosphere.setWeather(look);
  }

  /**
   * The biome around the camera (plan v4 « M39 »): its air's colour ('#rrggbb', null: none) tints
   * the horizon and the fog, its auroras (0–1) show by night; both ease in.
   */
  setAir(tint: string | null, aurora: number): void {
    this.atmosphere.setAir(tint, aurora);
  }

  /** The camera is inside a liquid: short teal fog, no sky, caustics. */
  setUnderwater(underwater: boolean): void {
    this.underwater = underwater;
    this.atmosphere.setUnderwater(underwater);
  }

  frame(dt: number): void {
    this.elapsed += dt;
    this.lightning.update(dt);
    const uniforms = this.materials.uniforms;
    uniforms.uTime.value = this.elapsed % 3600;
    uniforms.uFlicker.value = torchFlicker(this.elapsed);
    const atmosphere = this.atmosphere;
    atmosphere.update(
      this.fog,
      this.background,
      this.fogNear,
      this.fogFar,
      dt,
      this.elapsed % 3600,
    );
    const light = atmosphere.light;
    uniforms.uShadowStrength.value = this.shadow ? light.shadow : 0;
    const { x, y, z } = this.camera.position;
    atmosphere.sky.follow(x, y, z);
    this.chunks.cull(x, y, z, this.renderDistance);
    const webgl = this.renderer.webgl;
    // The shadow pass before the frame's counters: its draws are counted apart (`shadowDraws`).
    if (this.shadow && light.shadow > 0 && !this.underwater) {
      const { opaque, cutout } = this.materials;
      const at = this.camera.position;
      const dir = light.direction;
      this.shadow.update(webgl, this.chunkRoot, opaque, cutout, at, dir, this.chunks.revision);
    }
    webgl.info.reset();
    if (this.bloom) this.bloom.render(webgl, this.draw);
    else this.draw();
  }

  /** The world, then the hand over it, into the current target. */
  private readonly draw = (): void => {
    const webgl = this.renderer.webgl;
    webgl.render(this.scene, this.camera);
    const hand = this.hand;
    if (hand?.visible && hand.batch.size > 0) {
      webgl.autoClear = false;
      webgl.clearDepth();
      webgl.render(hand.scene, hand.camera);
      webgl.autoClear = true;
    }
  };

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
    return {
      width,
      height,
      avgLuma: luma / (width * height) / 255,
      uniqueColors: colors.size,
      hash: fnv1aBytes(pixels),
    };
  }

  dispose(): void {
    this.shadow?.dispose();
    this.bloom?.dispose();
    this.atmosphere.sky.dispose();
    this.lightning.dispose();
    this.chunks.clear();
    this.materials.dispose();
  }
}
