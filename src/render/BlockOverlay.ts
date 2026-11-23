import {
  BoxGeometry,
  BufferAttribute,
  CustomBlending,
  DstColorFactor,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  type Object3D,
  ShaderMaterial,
  ZeroFactor,
} from 'three';
import { type RawTables, SHAPE_BOXES } from '../content/registry.ts';
import { type ContentPack, CRACK_STAGES } from '../content/schema.ts';
import type { RayHit } from '../world/raycast.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';
import { overlayFragment, overlayVertex } from './shaders/overlay.glsl.ts';
import type { VoxelUniforms } from './voxelMaterial.ts';

/** The outline is this much larger than the block, so it never hides in the block's faces. */
const OUTLINE_SCALE = 1.004;
const OUTLINE_COLOR = '#11161c';
const OUTLINE_OPACITY = 0.7;
const GHOST_OPACITY = 0.42;
/** After the opaque and cutout chunks and the entities, before the translucent chunks (10). */
const OVERLAY_ORDER = 3;

/** What the overlays follow each frame: the aimed block and the planned placement. */
export interface OverlayTargets {
  /** The block under the crosshair (`hit` false: none). */
  readonly hit: Readonly<RayHit>;
  /** Where secondary would place a block, in which state (−1: nowhere). */
  readonly ghost: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly state: number;
  };
}

/** Texture layer of each crack stage (−1 when the pack has no `fracture` texture for it). */
export function crackLayers(pack: ContentPack): Int16Array {
  const layers = new Int16Array(CRACK_STAGES).fill(-1);
  pack.textures.forEach((tex, i) => {
    if (tex.pattern === 'fracture' && tex.stage !== undefined) layers[tex.stage] = i;
  });
  return layers;
}

/** A unit box (−0.5…0.5) whose vertices know their face (0–5, registry order). */
function faceBox(): BoxGeometry {
  const geometry = new BoxGeometry(1, 1, 1);
  const faces = new Float32Array(24);
  for (let v = 0; v < 24; v++) faces[v] = Math.floor(v / 4);
  geometry.setAttribute('aFace', new BufferAttribute(faces, 1));
  return geometry;
}

function overlayMaterial(shared: VoxelUniforms, multiply: boolean): ShaderMaterial {
  const material = new ShaderMaterial({
    vertexShader: overlayVertex,
    fragmentShader: overlayFragment,
    uniforms: {
      uTextures: shared.uTextures,
      uFaceLayers: { value: [0, 0, 0, 0, 0, 0] },
      uOpacity: { value: GHOST_OPACITY },
    },
    defines: multiply ? { MULTIPLY: '' } : {},
    transparent: true,
    depthWrite: false,
  });
  if (multiply) {
    material.blending = CustomBlending;
    material.blendSrc = DstColorFactor;
    material.blendDst = ZeroFactor;
    // Drawn on the block's own faces: pulled towards the camera instead of z-fighting them.
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -4;
  }
  return material;
}

/**
 * The target outline (the block's shape bounds × 1.004), the crack decal of the block being mined
 * (8 stages, polygon offset) and the translucent placement ghost. Three objects in the world scene,
 * hidden when unused.
 */
export class BlockOverlay {
  readonly group = new Group();
  private readonly world: VoxelWorld;
  private readonly tables: RawTables;
  private readonly cracks: Int16Array;
  private readonly outline: LineSegments;
  private readonly crack: Mesh;
  private readonly ghost: Mesh;
  private readonly bounds = new Float64Array(6);
  /** Crack stage shown (−1: none) and its cell, for tests and the debug hook. */
  crackStage = -1;
  private crackX = 0;
  private crackY = 0;
  private crackZ = 0;

  constructor(shared: VoxelUniforms, world: VoxelWorld, tables: RawTables, pack: ContentPack) {
    this.world = world;
    this.tables = tables;
    this.cracks = crackLayers(pack);
    this.outline = new LineSegments(
      new EdgesGeometry(new BoxGeometry(1, 1, 1)),
      new LineBasicMaterial({
        color: OUTLINE_COLOR,
        transparent: true,
        opacity: OUTLINE_OPACITY,
        depthWrite: false,
      }),
    );
    this.crack = new Mesh(faceBox(), overlayMaterial(shared, true));
    this.ghost = new Mesh(faceBox(), overlayMaterial(shared, false));
    for (const object of [this.outline, this.crack, this.ghost]) {
      object.visible = false;
      object.renderOrder = OVERLAY_ORDER;
      object.frustumCulled = false;
      this.group.add(object);
    }
  }

  /** Shows the crack of a mined block (`stage` −1 hides it). */
  setCrack(x: number, y: number, z: number, stage: number): void {
    this.crackStage = stage;
    this.crackX = x;
    this.crackY = y;
    this.crackZ = z;
  }

  /** Places the three overlays for this frame. */
  update(targets: OverlayTargets): void {
    const hit = targets.hit;
    this.outline.visible = hit.hit;
    if (hit.hit) this.fit(this.outline, hit.x, hit.y, hit.z, hit.state, OUTLINE_SCALE);
    const layer = this.crackStage >= 0 ? this.cracks[this.crackStage]! : -1;
    this.crack.visible = layer >= 0;
    if (layer >= 0) {
      const state = this.world.getBlock(this.crackX, this.crackY, this.crackZ);
      this.fit(this.crack, this.crackX, this.crackY, this.crackZ, state, 1);
      setFaceLayers(this.crack, layer, layer, layer, layer, layer, layer);
    }
    const ghost = targets.ghost;
    this.ghost.visible = ghost.state >= 0;
    if (ghost.state >= 0) {
      this.fit(this.ghost, ghost.x, ghost.y, ghost.z, ghost.state, 1);
      const l = this.tables.faceLayer;
      const s = ghost.state * 6;
      setFaceLayers(this.ghost, l[s]!, l[s + 1]!, l[s + 2]!, l[s + 3]!, l[s + 4]!, l[s + 5]!);
    }
  }

  dispose(): void {
    for (const object of [this.outline, this.crack, this.ghost]) {
      object.geometry.dispose();
      (object.material as ShaderMaterial).dispose();
    }
  }

  /** Scales and moves a unit box object onto the shape bounds of a block state. */
  private fit(
    object: Object3D,
    x: number,
    y: number,
    z: number,
    state: number,
    scale: number,
  ): void {
    const b = this.bounds;
    shapeBounds(this.tables, state, b);
    object.position.set(x + (b[0]! + b[3]!) / 2, y + (b[1]! + b[4]!) / 2, z + (b[2]! + b[5]!) / 2);
    object.scale.set((b[3]! - b[0]!) * scale, (b[4]! - b[1]!) * scale, (b[5]! - b[2]!) * scale);
  }
}

function setFaceLayers(
  mesh: Mesh,
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
): void {
  const layers = (mesh.material as ShaderMaterial).uniforms.uFaceLayers!.value as number[];
  layers[0] = a;
  layers[1] = b;
  layers[2] = c;
  layers[3] = d;
  layers[4] = e;
  layers[5] = f;
}

/**
 * Bounds of a block state's shape inside its cell, as x0, y0, z0, x1, y1, z1 (0…1): the union of
 * its boxes, or the whole cell.
 */
export function shapeBounds(tables: RawTables, state: number, out: Float64Array): void {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  out[3] = 1;
  out[4] = 1;
  out[5] = 1;
  if (tables.shape[state] !== SHAPE_BOXES) return;
  const boxes = tables.boxShapes[tables.boxShape[state]!]!;
  if (boxes.length === 0) return;
  for (let k = 0; k < 3; k++) {
    out[k] = 1;
    out[k + 3] = 0;
  }
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i]!;
    for (let k = 0; k < 3; k++) {
      out[k] = Math.min(out[k]!, box[k]! / 16);
      out[k + 3] = Math.max(out[k + 3]!, box[k + 3]! / 16);
    }
  }
}
