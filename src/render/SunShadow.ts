import {
  BackSide,
  DepthTexture,
  DoubleSide,
  LessEqualCompare,
  LinearFilter,
  Matrix4,
  type Mesh,
  type Object3D,
  OrthographicCamera,
  ShaderMaterial,
  type Side,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { shadowFragment, shadowVertex } from './shaders/shadow.glsl.ts';
import type { VoxelUniforms } from './voxelMaterial.ts';

/**
 * The sun's shadow map (plan v4 « M37 », decision 28): the chunk meshes around the camera drawn
 * from the sun (or the moon) into a depth texture, which the chunk and box shaders compare
 * against (`sunShadow`, lighting.glsl.ts). The map is square, aligned with the light and moved in
 * whole texels, so its shadows do not crawl as the camera moves; it is drawn again every few
 * frames (the sun moves slowly) or when the camera strays from its centre.
 */

/** Blocks a map side covers per 1024 texels: 1024² over 48 blocks (medium), 2048² over 96 (high). */
const BLOCKS_PER_1024 = 48;
/** The light's camera sits this far from the focus: casters up to it are in the map. */
const LIGHT_DISTANCE = 128;
/** The map is drawn again after this many frames, or when the focus strays this share of a side. */
const REDRAW_FRAMES = 12;
/** A change of meshes redraws it sooner, but never twice within this many frames (streaming). */
const CHANGED_FRAMES = 4;
const STRAY = 0.2;

const BIAS = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const UP_Y = new Vector3(0, 1, 0);
const UP_Z = new Vector3(0, 0, 1);
const right = new Vector3();
const up = new Vector3();
const centre = new Vector3();

/** The blocks one side of a `size` map covers. */
export function shadowExtent(size: number): number {
  return (size / 1024) * BLOCKS_PER_1024;
}

/**
 * Places the light's camera over `focus` along `dir` (towards the light) and returns its target,
 * moved in whole texels of the map across the light's view (`texel` blocks), so the same world
 * point stays on the same texel from one map to the next. Writes `out`; no allocation.
 */
export function shadowFocus(
  camera: OrthographicCamera,
  focus: Vector3,
  dir: Vector3,
  texel: number,
  out: Vector3,
): Vector3 {
  // three's lookAt builds x = up × z and y = z × x, with z = dir: snap along those two.
  camera.up.copy(Math.abs(dir.y) > 0.99 ? UP_Z : UP_Y);
  right.crossVectors(camera.up, dir).normalize();
  up.crossVectors(dir, right);
  const r = focus.dot(right);
  const u = focus.dot(up);
  out
    .copy(focus)
    .addScaledVector(right, Math.round(r / texel) * texel - r)
    .addScaledVector(up, Math.round(u / texel) * texel - u);
  camera.position.copy(out).addScaledVector(dir, LIGHT_DISTANCE);
  camera.lookAt(out);
  camera.updateMatrixWorld();
  return out;
}

export class SunShadow {
  readonly texture: DepthTexture;
  /** World → map coordinates (0–1 across, depth 0–1). */
  readonly matrix = new Matrix4();
  /** Texels a side, and one texel in map coordinates. */
  readonly size: number;
  readonly texel: number;
  /** Draw calls of the last pass. */
  draws = 0;
  private readonly target: WebGLRenderTarget;
  private readonly camera: OrthographicCamera;
  /** The blocks a side covers, and one texel. */
  private readonly extent: number;
  private readonly blocksPerTexel: number;
  private readonly opaque: ShaderMaterial;
  private readonly cutout: ShaderMaterial;
  private readonly hidden: Mesh[] = [];
  private frames = REDRAW_FRAMES;
  /** The meshes' revision of the last pass. */
  private revision = -1;
  /** Where the map was last drawn around (NaN: never). */
  private readonly drawnAt = new Vector3(Number.NaN, 0, 0);

  /** `uniforms`: the chunks' (textures, time and wind: plants sway in their shadows too). */
  constructor(size: number, uniforms: VoxelUniforms) {
    const extent = shadowExtent(size);
    this.size = size;
    this.texel = 1 / size;
    this.extent = extent;
    this.blocksPerTexel = extent / size;
    const depth = new DepthTexture(size, size);
    depth.compareFunction = LessEqualCompare;
    // Linear filtering on a compared depth texture: the hardware blends four comparisons.
    depth.magFilter = LinearFilter;
    depth.minFilter = LinearFilter;
    this.texture = depth;
    this.target = new WebGLRenderTarget(size, size, { depthTexture: depth });
    const half = extent / 2;
    this.camera = new OrthographicCamera(-half, half, half, -half, 1, LIGHT_DISTANCE * 2);
    const make = (defines: Record<string, string>, side: Side) =>
      new ShaderMaterial({
        vertexShader: shadowVertex,
        fragmentShader: shadowFragment,
        uniforms: { uTextures: uniforms.uTextures, uTime: uniforms.uTime, uWind: uniforms.uWind },
        defines,
        side,
      });
    // Back faces cast: a lit face never compares against itself (no shadow acne).
    this.opaque = make({}, BackSide);
    this.cutout = make({ ALPHA_CUTOUT: '' }, DoubleSide);
  }

  /**
   * Draws the map around `focus` towards `dir` when due: every REDRAW_FRAMES frames, when the focus
   * strays, or CHANGED_FRAMES after the meshes changed (`revision`). `root` holds the chunk meshes, drawn with
   * `opaque` or `cutout` (others, the translucent ones, cast nothing).
   */
  update(
    webgl: WebGLRenderer,
    root: Object3D,
    opaque: ShaderMaterial,
    cutout: ShaderMaterial,
    focus: Vector3,
    dir: Vector3,
    revision: number,
  ): void {
    // NaN at first: no distance is under it, so the first call draws.
    const stray = this.drawnAt.distanceTo(focus);
    const frames = ++this.frames;
    const due = frames >= REDRAW_FRAMES || (revision !== this.revision && frames >= CHANGED_FRAMES);
    if (!due && stray < STRAY * this.extent) return;
    this.frames = 0;
    this.revision = revision;
    this.drawnAt.copy(focus);
    shadowFocus(this.camera, focus, dir, this.blocksPerTexel, centre);
    this.matrix
      .copy(BIAS)
      .multiply(this.camera.projectionMatrix)
      .multiply(this.camera.matrixWorldInverse);
    for (const child of root.children) {
      const mesh = child as Mesh;
      if (mesh.material === opaque) mesh.material = this.opaque;
      else if (mesh.material === cutout) mesh.material = this.cutout;
      else if (mesh.visible) {
        mesh.visible = false;
        this.hidden.push(mesh);
      }
    }
    const calls = webgl.info.render.calls;
    webgl.setRenderTarget(this.target);
    webgl.clear();
    webgl.render(root, this.camera);
    webgl.setRenderTarget(null);
    this.draws = webgl.info.render.calls - calls;
    for (const child of root.children) {
      const mesh = child as Mesh;
      if (mesh.material === this.opaque) mesh.material = opaque;
      else if (mesh.material === this.cutout) mesh.material = cutout;
    }
    for (const mesh of this.hidden) mesh.visible = true;
    this.hidden.length = 0;
  }

  dispose(): void {
    this.target.dispose();
    this.texture.dispose();
    this.opaque.dispose();
    this.cutout.dispose();
  }
}
