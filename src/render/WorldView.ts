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
import { ChunkMeshes } from './ChunkMeshes.ts';
import type { HandView } from './HandView.ts';
import { Precipitation } from './Precipitation.ts';
import type { Renderer } from './Renderer.ts';
import { Sky } from './Sky.ts';
import { SunShadow } from './SunShadow.ts';
import { createSunLight, mistAt, sunLightAt } from './sunLight.ts';
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
}

/** What the weather looks like (plan v3 « M34 », the client's WeatherFeel): 0–1 each. */
export interface WeatherLook {
  cloud: number;
  fog: number;
  flash: number;
  /** The share of the sky's light the clouds leave. */
  dim: number;
  /** Rain on the ground around the camera (plan v4 « M37 »): surfaces darker and glossy. */
  wet: number;
}

/** How far clouds turn the sky grey, and how much darker that grey gets under full cloud. */
const CLOUD_GREY = 0.8;
const CLOUD_DARK = 0.5;
/** A flash's light on the blocks and whitening of the sky. */
const FLASH_LIGHT = 0.6;
const FLASH_SKY = 0.5;
/** Thick fog pulls the fog's start and end this much closer. */
const FOG_NEAR = 0.85;
const FOG_FAR = 0.65;
const scratch = new Color();

/** Underwater fog (docs « Ciel et brouillard »): blue, from 1 to 20 blocks. */
const WATER_FOG = new Color('#1f4f78');
const WATER_FOG_NEAR = 1;
const WATER_FOG_FAR = 20;

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
  private readonly sky = new Sky();
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
  /** Hour of the day shown: noon until a world clock sets it (`setTime`). */
  private hour = 12;
  private daylight = 1;
  /** The weather shown (plan v3 « M34 »): clouds, fog and a lightning flash, 0–1; the sky's dim. */
  private readonly weather: WeatherLook = { cloud: 0, fog: 0, flash: 0, dim: 1, wet: 0 };
  /** The sky's light now (`sunLightAt`) and the sun's shadow map (null: shadows off). */
  private readonly light = createSunLight();
  private shadow: SunShadow | null = null;
  /** Rain and snow around the camera (filled by the client each frame). */
  readonly precipitation = new Precipitation();
  private underwater = false;
  private hand: HandView | null = null;
  private elapsed = 0;
  /** The field of view setting (degrees). */
  private fov = this.camera.fov;

  constructor(
    renderer: Renderer,
    textures: PackTextures,
    tintColors: readonly string[],
    renderDistance: number,
  ) {
    this.renderer = renderer;
    const anisotropy = Math.min(ANISOTROPY, renderer.webgl.capabilities.getMaxAnisotropy());
    textures.textures.anisotropy = anisotropy;
    textures.materials.anisotropy = anisotropy;
    this.materials = createVoxelMaterials(textures, tintColors);
    this.chunks = new ChunkMeshes(this.chunkRoot, this.materials);
    this.scene.add(this.chunkRoot, this.sky.mesh, this.precipitation.rain, this.precipitation.snow);
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
    this.shadow = size > 0 ? new SunShadow(size, uniforms.uTextures.value) : null;
    uniforms.uShadowMap.value = this.shadow?.texture ?? null;
    uniforms.uShadowTexel.value = this.shadow?.texel ?? 0;
    uniforms.uShadowMatrix.value = this.shadow?.matrix ?? uniforms.uShadowMatrix.value;
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
   * Time of day: the sky palette, sun, moon and stars follow `hour` (0 ≤ hour < 24), and sky light
   * is scaled by `daylight` in the shaders (the world is never re-lit).
   */
  setTime(hour: number, daylight: number): void {
    this.hour = hour;
    this.daylight = daylight;
    this.materials.uniforms.uDaylight.value = this.litDaylight();
  }

  /**
   * The weather shown (plan v3 « M34 »): clouds grey and darken the sky, fog closes in, a
   * lightning flash lights everything for a moment; `dim` scales the sky's light on the blocks.
   */
  setWeather(look: Readonly<WeatherLook>): void {
    Object.assign(this.weather, look);
    this.materials.uniforms.uDaylight.value = this.litDaylight();
  }

  /** The sky's light on the blocks: the hour's under the clouds, a flash on top. */
  private litDaylight(): number {
    const w = this.weather;
    return Math.min(1, this.daylight * w.dim + FLASH_LIGHT * w.flash);
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
    const { x, y, z } = this.camera.position;
    this.sky.follow(x, y, z);
    this.chunks.cull(x, y, z, this.renderDistance);
    const webgl = this.renderer.webgl;
    // The shadow pass before the frame's counters: its draws are counted apart (`shadowDraws`).
    if (this.shadow && this.light.shadow > 0 && !this.underwater) {
      const { opaque, cutout } = this.materials;
      const at = this.camera.position;
      const dir = this.light.direction;
      this.shadow.update(webgl, this.chunkRoot, opaque, cutout, at, dir, this.chunks.revision);
    }
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
    this.weatherSky();
    const weather = this.weather;
    const light = sunLightAt(this.hour, sky.colors.light, weather.cloud, this.light);
    uniforms.uSunDir.value.copy(light.direction);
    uniforms.uSunLight.value.copy(light.direct);
    uniforms.uSkyLight.value.copy(light.sky);
    uniforms.uGroundLight.value.copy(light.ground);
    uniforms.uShadowStrength.value = this.shadow ? light.shadow : 0;
    uniforms.uWetness.value = weather.wet;
    uniforms.uMist.value = this.underwater ? 0 : mistAt(this.hour) * (1 - weather.fog);
    const fog = this.fog;
    if (this.underwater) {
      // Darker water at night, never black.
      fog.color.copy(WATER_FOG).multiplyScalar(0.2 + 0.8 * uniforms.uDaylight.value);
      fog.near = WATER_FOG_NEAR;
      fog.far = WATER_FOG_FAR;
    } else {
      fog.color.copy(sky.colors.horizon);
      // The weather's fog closes in (thick fog: a third of the render distance).
      const thick = this.weather.fog;
      fog.near = this.fogNear * (1 - FOG_NEAR * thick);
      fog.far = this.fogFar * (1 - FOG_FAR * thick);
    }
    sky.mesh.visible = !this.underwater;
    this.background.copy(fog.color);
  }

  /** Clouds grey and darken the sky's colours; a flash whitens them. No allocation. */
  private weatherSky(): void {
    const { cloud, flash } = this.weather;
    if (cloud <= 0 && flash <= 0) return;
    const c = this.sky.colors;
    for (const colour of [c.zenith, c.horizon]) {
      const grey = (colour.r * 0.3 + colour.g * 0.59 + colour.b * 0.11) * (1 - CLOUD_DARK * cloud);
      colour.lerp(scratch.setRGB(grey, grey, grey), CLOUD_GREY * cloud);
      colour.lerp(scratch.setRGB(1, 1, 1), FLASH_SKY * flash);
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
    this.shadow?.dispose();
    this.sky.dispose();
    this.chunks.clear();
    this.materials.dispose();
  }
}
