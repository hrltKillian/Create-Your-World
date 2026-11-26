import { boxFacing, effective, internBoxes } from './blockStates.ts';
import type { StateInfo } from './registry.ts';
import type {
  BlockDef,
  BlockShape,
  Box16,
  ContentPack,
  RenderPass,
  StateProp,
  TexKey,
} from './schema.ts';
import { textureSets } from './validate.ts';

/**
 * The raw tables of a pack (docs « Registres »): every block state's codes and face data in typed
 * arrays indexed by state id, which the workers and every hot loop read instead of the block
 * definitions. Re-exported by `registry.ts`.
 */

/** Face order used everywhere: +x, −x, +y, −y, +z, −z (north = −z). */
export const FACE_EAST = 0;
export const FACE_WEST = 1;
export const FACE_UP = 2;
export const FACE_DOWN = 3;
export const FACE_SOUTH = 4;
export const FACE_NORTH = 5;

export const PASS_NONE = 0;
export const PASS_OPAQUE = 1;
export const PASS_CUTOUT = 2;
export const PASS_TRANSLUCENT = 3;

export const SHAPE_NONE = 0;
export const SHAPE_CUBE = 1;
export const SHAPE_CROSS = 2;
export const SHAPE_LIQUID = 3;
export const SHAPE_BOXES = 4;

/** Per-state flags. */
export const FLAG_SOLID = 1;
export const FLAG_OPAQUE = 2;
export const FLAG_LIQUID = 4;
export const FLAG_REPLACEABLE = 8;
/** A ladder: bodies climb in it (sim/physics.ts). */
export const FLAG_CLIMBABLE = 16;

/** Per-face flags (also written into vertices). */
export const FACEFLAG_SWAY = 1;
export const FACEFLAG_EMISSIVE = 2;
export const FACEFLAG_UV_ROTATE = 4;

export const TINT_NONE = 0;
export const TINT_GRASS = 1;
export const TINT_FOLIAGE = 2;
export const TINT_WATER = 3;

/** Colour of TINT_NONE (slot 0 of the voxel shader's tint table): untinted. sRGB hex. */
export const NO_TINT = '#ffffff';

/**
 * The pack's own colour of each tint channel, indexed by TINT_* (sRGB hex): the tint table of
 * worlds without biomes, item icons and item models.
 */
export function packTints(pack: ContentPack): string[] {
  return [NO_TINT, pack.tints.grass, pack.tints.foliage, pack.tints.water];
}

/**
 * Lookup tables indexed by the raw 16-bit voxel value (a flattened block-state id).
 * Sent once to the workers; every hot loop reads these instead of block definitions.
 */
export interface RawTables {
  readonly stateCount: number;
  readonly blockOf: Uint16Array;
  readonly flags: Uint8Array;
  readonly emit: Uint8Array;
  readonly lightFilter: Uint8Array;
  readonly pass: Uint8Array;
  readonly shape: Uint8Array;
  readonly tint: Uint8Array;
  readonly cullGroup: Uint8Array;
  /** `state * 6 + face` → tint channel (TINT_*), 0 for untinted faces. */
  readonly faceTint: Uint8Array;
  /** `state * 6 + face` → texture layer. */
  readonly faceLayer: Uint16Array;
  /** `state * 6 + face` → FACEFLAG_* bits. */
  readonly faceFlags: Uint8Array;
  /** State → index into `boxShapes` (only for SHAPE_BOXES). */
  readonly boxShape: Uint16Array;
  readonly boxShapes: readonly (readonly Box16[])[];
  /** State → collision: COLLISION_NONE, COLLISION_FULL, COLLISION_LIQUID, or COLLISION_BOXES + index. */
  readonly collision: Uint16Array;
  readonly collisionBoxes: readonly (readonly Box16[])[];
  /** State → ground acceleration factor × 100 (ice 20). */
  readonly friction: Uint8Array;
  /** State → heat source: °C at the block, warming up to `heatRadius` blocks (environment.ts). */
  readonly heat: Int8Array;
  readonly heatRadius: Uint8Array;
  /**
   * State → height of a liquid's surface in sixteenths of its cell (by its `level`), 0 for other
   * blocks; a liquid under the same liquid fills its cell (physics, meshing).
   */
  readonly liquidHeight: Uint8Array;
}

/** Surface height (sixteenths) of a liquid by its level: a source, then ever thinner flows. */
export const LIQUID_HEIGHTS = [14, 12, 10, 9, 7, 5, 3, 2] as const;

export const COLLISION_NONE = 0;
export const COLLISION_FULL = 1;
export const COLLISION_LIQUID = 2;
/** Values ≥ this index `collisionBoxes[value - COLLISION_BOXES]`. */
export const COLLISION_BOXES = 3;

/** The tables of a pack's states (`states`: every combination of a block's state values). */
export function buildRawTables(pack: ContentPack, states: readonly StateInfo[]): RawTables {
  const textureLayer = new Map(pack.textures.map((t, i) => [t.key as string, i]));
  const { emissive, tintable } = textureSets(pack);
  const cullGroups = new Map<string, number>();

  const n = states.length;
  const tables = {
    stateCount: n,
    blockOf: new Uint16Array(n),
    flags: new Uint8Array(n),
    emit: new Uint8Array(n),
    lightFilter: new Uint8Array(n),
    pass: new Uint8Array(n),
    shape: new Uint8Array(n),
    tint: new Uint8Array(n),
    cullGroup: new Uint8Array(n),
    faceTint: new Uint8Array(n * 6),
    faceLayer: new Uint16Array(n * 6),
    faceFlags: new Uint8Array(n * 6),
    boxShape: new Uint16Array(n),
    boxShapes: [] as Box16[][],
    collision: new Uint16Array(n),
    collisionBoxes: [] as Box16[][],
    friction: new Uint8Array(n),
    heat: new Int8Array(n),
    heatRadius: new Uint8Array(n),
    liquidHeight: new Uint8Array(n),
  };
  // Box lists interned by their text (states sharing boxes share an index).
  const collisions = new Map<string, number>();
  const shapes = new Map<string, number>();
  const art: FaceArt = { textureLayer, emissive, tintable };

  for (const state of states) {
    const block = pack.blocks[state.block]!;
    const eff = effective(block, state.props);
    const s = state.id;
    tables.blockOf[s] = state.block;
    const collides = eff.collision !== 'none' && eff.collision !== 'liquid';
    tables.flags[s] =
      (collides ? FLAG_SOLID : 0) |
      (eff.opaque ? FLAG_OPAQUE : 0) |
      (block.shape === 'liquid' ? FLAG_LIQUID : 0) |
      (block.replaceable ? FLAG_REPLACEABLE : 0) |
      (block.climbable ? FLAG_CLIMBABLE : 0);
    tables.emit[s] = eff.emit;
    tables.lightFilter[s] = eff.opaque ? 15 : eff.filter;
    tables.pass[s] = passCode(block.pass, block.shape);
    tables.shape[s] = shapeCode(eff.shape);
    const tint =
      block.tint === 'grass'
        ? TINT_GRASS
        : block.tint === 'foliage'
          ? TINT_FOLIAGE
          : block.tint === 'water'
            ? TINT_WATER
            : TINT_NONE;
    tables.tint[s] = tint;
    if (block.cullGroup) {
      if (!cullGroups.has(block.cullGroup)) cullGroups.set(block.cullGroup, cullGroups.size + 1);
      tables.cullGroup[s] = cullGroups.get(block.cullGroup)!;
    }
    tables.friction[s] = Math.round((block.friction ?? 1) * 100);
    tables.heat[s] = eff.heat?.celsius ?? 0;
    tables.heatRadius[s] = eff.heat?.radius ?? 0;
    if (block.shape === 'liquid') {
      const level = Number(state.props.level ?? '0');
      tables.liquidHeight[s] = state.props.falling === '1' ? 16 : LIQUID_HEIGHTS[level]!;
    }
    if (eff.collision === 'full') tables.collision[s] = COLLISION_FULL;
    else if (eff.collision === 'liquid') tables.collision[s] = COLLISION_LIQUID;
    else if (typeof eff.collision === 'object') {
      const boxes = eff.collision.boxes;
      const index = internBoxes(boxes, boxFacing(state.props), tables.collisionBoxes, collisions);
      tables.collision[s] = COLLISION_BOXES + index;
    }
    if (typeof eff.shape === 'object') {
      const boxes = eff.shape.boxes;
      tables.boxShape[s] = internBoxes(boxes, boxFacing(state.props), tables.boxShapes, shapes);
    }
    writeFaces(tables, state, block, eff.textures, tint, art);
  }

  return tables;
}

/** What a face's data reads of the pack's textures. */
interface FaceArt {
  readonly textureLayer: ReadonlyMap<string, number>;
  readonly emissive: ReadonlySet<string>;
  readonly tintable: ReadonlySet<string>;
}

/** The six faces of a state: texture layer, tint channel and flags. */
function writeFaces(
  tables: { faceLayer: Uint16Array; faceTint: Uint8Array; faceFlags: Uint8Array },
  state: StateInfo,
  block: BlockDef,
  textures: BlockDef['textures'],
  tint: number,
  art: FaceArt,
): void {
  const s = state.id;
  // A plant that gives light glows whole (plan v4 « M40 »: Veyra's bioluminescent flora).
  const glows = block.shape === 'cross' && (block.light?.emit ?? 0) > 0;
  for (let face = 0; face < 6; face++) {
    const { key, rotate } = faceTexture(textures, face, state.props);
    tables.faceLayer[s * 6 + face] = key ? (art.textureLayer.get(key) ?? 0) : 0;
    // Opaque faces use alpha as a mask: only tint-aware textures take the tint. Cutout and
    // translucent faces use alpha as coverage and are tinted whole.
    tables.faceTint[s * 6 + face] =
      block.pass !== 'opaque' || (key && art.tintable.has(key)) ? tint : TINT_NONE;
    tables.faceFlags[s * 6 + face] =
      (rotate ? FACEFLAG_UV_ROTATE : 0) |
      ((key && art.emissive.has(key)) || glows ? FACEFLAG_EMISSIVE : 0) |
      (block.tint === 'foliage' || block.shape === 'cross' ? FACEFLAG_SWAY : 0);
  }
}

function passCode(pass: RenderPass, shape: BlockShape): number {
  if (shape === 'none') return PASS_NONE;
  switch (pass) {
    case 'opaque':
      return PASS_OPAQUE;
    case 'cutout':
      return PASS_CUTOUT;
    case 'translucent':
      return PASS_TRANSLUCENT;
    case 'invisible':
      return PASS_NONE;
  }
}

function shapeCode(shape: BlockShape): number {
  if (typeof shape === 'object') return SHAPE_BOXES;
  switch (shape) {
    case 'cube':
      return SHAPE_CUBE;
    case 'cross':
      return SHAPE_CROSS;
    case 'liquid':
      return SHAPE_LIQUID;
    case 'none':
      return SHAPE_NONE;
  }
}

const FACING_FACE: Readonly<Record<string, number>> = {
  n: FACE_NORTH,
  e: FACE_EAST,
  s: FACE_SOUTH,
  w: FACE_WEST,
};

/** Texture for one face, handling `front` (facing), `top`/`bottom` and log axes. */
function faceTexture(
  textures: BlockDef['textures'],
  face: number,
  props: Readonly<Partial<Record<StateProp, string>>>,
): { key: TexKey | undefined; rotate: boolean } {
  const axis = props.axis ?? 'y';
  const endFaces =
    axis === 'x'
      ? [FACE_EAST, FACE_WEST]
      : axis === 'z'
        ? [FACE_SOUTH, FACE_NORTH]
        : [FACE_UP, FACE_DOWN];
  const isEnd = endFaces.includes(face);
  if (props.axis !== undefined) {
    const key = isEnd ? (textures.top ?? textures.all) : (textures.side ?? textures.all);
    // Bark grain runs along the texture's v axis: sides have v = y, top/bottom have v = z.
    const faceV = face === FACE_UP || face === FACE_DOWN ? 'z' : 'y';
    return { key, rotate: !isEnd && faceV !== axis };
  }
  if (face === FACE_UP) return { key: textures.top ?? textures.all, rotate: false };
  if (face === FACE_DOWN)
    return { key: textures.bottom ?? textures.top ?? textures.all, rotate: false };
  const front = props.facing4 !== undefined && FACING_FACE[props.facing4] === face;
  return {
    key: (front ? textures.front : undefined) ?? textures.side ?? textures.all,
    rotate: false,
  };
}
