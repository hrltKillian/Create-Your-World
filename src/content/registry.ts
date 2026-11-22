import {
  type BlockDef,
  type BlockKey,
  type BlockOverride,
  type BlockShape,
  type Box16,
  type ContentPack,
  type RenderPass,
  STATE_VALUES,
  type StateProp,
  type TexKey,
} from './schema.ts';
import { type ContentIssue, validatePack } from './validate.ts';

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

/** Per-face flags (also written into vertices). */
export const FACEFLAG_SWAY = 1;
export const FACEFLAG_EMISSIVE = 2;
export const FACEFLAG_UV_ROTATE = 4;

export const TINT_NONE = 0;
export const TINT_GRASS = 1;
export const TINT_FOLIAGE = 2;
export const TINT_WATER = 3;

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
}

export const COLLISION_NONE = 0;
export const COLLISION_FULL = 1;
export const COLLISION_LIQUID = 2;
/** Values ≥ this index `collisionBoxes[value - COLLISION_BOXES]`. */
export const COLLISION_BOXES = 3;

export interface StateInfo {
  readonly id: number;
  readonly block: number;
  /** Text key, e.g. `block:gate[facing4=n,open=1]`; saves store these. */
  readonly key: string;
  readonly props: Readonly<Partial<Record<StateProp, string>>>;
}

export class ContentError extends Error {
  readonly issues: readonly ContentIssue[];

  constructor(issues: readonly ContentIssue[]) {
    super(`Invalid content pack:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`);
    this.name = 'ContentError';
    this.issues = issues;
  }
}

export class Registry {
  readonly pack: ContentPack;
  readonly blocks: readonly BlockDef[];
  readonly states: readonly StateInfo[];
  readonly tables: RawTables;
  readonly textureKeys: readonly TexKey[];
  readonly air: number;
  readonly unknownBlock: number;
  private readonly blockIndex: ReadonlyMap<string, number>;
  private readonly stateIndex: ReadonlyMap<string, number>;
  private readonly defaults: Uint16Array;

  constructor(
    pack: ContentPack,
    states: StateInfo[],
    tables: RawTables,
    blockIndex: Map<string, number>,
    defaults: Uint16Array,
  ) {
    this.pack = pack;
    this.blocks = pack.blocks;
    this.states = states;
    this.tables = tables;
    this.textureKeys = pack.textures.map((t) => t.key);
    this.blockIndex = blockIndex;
    this.stateIndex = new Map(states.map((s) => [s.key, s.id]));
    this.defaults = defaults;
    this.air = this.defaultState(pack.manifest.bindings.air);
    this.unknownBlock = this.defaultState(pack.manifest.bindings.unknownBlock);
  }

  blockDef(stateId: number): BlockDef {
    return this.blocks[this.tables.blockOf[stateId]!]!;
  }

  hasBlock(key: string): boolean {
    return this.blockIndex.has(key);
  }

  defaultState(key: BlockKey): number {
    const index = this.blockIndex.get(key);
    if (index === undefined) throw new Error(`Unknown block "${key}"`);
    return this.defaults[index]!;
  }

  /** State id for a text key; unknown keys map to the unknown block (used when loading saves). */
  stateIdOrUnknown(key: string): number {
    return this.stateIndex.get(key) ?? this.unknownBlock;
  }

  stateId(key: string): number {
    const id = this.stateIndex.get(key);
    if (id === undefined) throw new Error(`Unknown block state "${key}"`);
    return id;
  }

  prop(stateId: number, prop: StateProp): string | undefined {
    return this.states[stateId]?.props[prop];
  }

  /** Same block with one state property changed. */
  withState(stateId: number, prop: StateProp, value: string): number {
    const info = this.states[stateId];
    if (!info || info.props[prop] === undefined) return stateId;
    const block = this.blocks[info.block]!;
    return this.stateId(stateKey(block, { ...info.props, [prop]: value }));
  }
}

export function stateKey(
  block: BlockDef,
  props: Readonly<Partial<Record<StateProp, string>>>,
): string {
  const names = block.states ?? [];
  if (names.length === 0) return block.key;
  return `${block.key}[${names.map((name) => `${name}=${props[name]}`).join(',')}]`;
}

/** Validates the pack and flattens every (block, state values) combination into a state id. */
export function buildRegistry(pack: ContentPack): Registry {
  const issues = validatePack(pack);
  if (issues.length > 0) throw new ContentError(issues);

  const textureLayer = new Map(pack.textures.map((t, i) => [t.key as string, i]));
  const emissive = new Set(
    pack.textures.filter((t) => t.alpha === 'emissiveMask').map((t) => t.key as string),
  );
  const tintable = new Set(
    pack.textures
      .filter((t) => t.alpha === 'tintMask' || t.alpha === 'tintFull')
      .map((t) => t.key as string),
  );
  const cullGroups = new Map<string, number>();

  const states: StateInfo[] = [];
  const blockIndex = new Map<string, number>();
  const defaults = new Uint16Array(pack.blocks.length);
  pack.blocks.forEach((block, b) => {
    blockIndex.set(block.key, b);
    defaults[b] = states.length;
    for (const props of combinations(block.states ?? [])) {
      states.push({ id: states.length, block: b, key: stateKey(block, props), props });
    }
  });

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
  };
  const collisionIndex = new Map<string, number>();
  const boxShapeIndex = new Map<string, number>();

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
      (block.replaceable ? FLAG_REPLACEABLE : 0);
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
    if (eff.collision === 'full') tables.collision[s] = COLLISION_FULL;
    else if (eff.collision === 'liquid') tables.collision[s] = COLLISION_LIQUID;
    else if (typeof eff.collision === 'object') {
      const quarter = facingQuarterTurns(state.props.facing4);
      const boxes = eff.collision.boxes.map((box) => rotateBoxY(box, quarter));
      const id = JSON.stringify(boxes);
      let index = collisionIndex.get(id);
      if (index === undefined) {
        index = tables.collisionBoxes.length;
        tables.collisionBoxes.push(boxes);
        collisionIndex.set(id, index);
      }
      tables.collision[s] = COLLISION_BOXES + index;
    }
    if (typeof eff.shape === 'object') {
      const quarter = facingQuarterTurns(state.props.facing4);
      const boxes = eff.shape.boxes.map((box) => rotateBoxY(box, quarter));
      const id = JSON.stringify(boxes);
      let index = boxShapeIndex.get(id);
      if (index === undefined) {
        index = tables.boxShapes.length;
        tables.boxShapes.push(boxes);
        boxShapeIndex.set(id, index);
      }
      tables.boxShape[s] = index;
    }
    for (let face = 0; face < 6; face++) {
      const { key, rotate } = faceTexture(eff.textures, face, state.props);
      tables.faceLayer[s * 6 + face] = key ? (textureLayer.get(key) ?? 0) : 0;
      // Opaque faces use alpha as a mask: only tint-aware textures take the tint. Cutout and
      // translucent faces use alpha as coverage and are tinted whole.
      tables.faceTint[s * 6 + face] =
        block.pass !== 'opaque' || (key && tintable.has(key)) ? tint : TINT_NONE;
      tables.faceFlags[s * 6 + face] =
        (rotate ? FACEFLAG_UV_ROTATE : 0) |
        (key && emissive.has(key) ? FACEFLAG_EMISSIVE : 0) |
        (block.tint === 'foliage' || block.shape === 'cross' ? FACEFLAG_SWAY : 0);
    }
  }

  return new Registry(pack, states, tables, blockIndex, defaults);
}

interface Effective {
  readonly opaque: boolean;
  readonly emit: number;
  readonly filter: number;
  readonly collision: BlockDef['collision'];
  readonly textures: BlockDef['textures'];
  readonly shape: BlockShape;
}

/** Block properties after applying `whenState` overrides for the active state values. */
function effective(
  block: BlockDef,
  props: Readonly<Partial<Record<StateProp, string>>>,
): Effective {
  let result: Effective = {
    opaque: block.opaque,
    emit: block.light?.emit ?? 0,
    filter: block.light?.filter ?? 0,
    collision: block.collision,
    textures: block.textures,
    shape: block.shape,
  };
  for (const [prop, override] of Object.entries(block.whenState ?? {}) as [
    StateProp,
    BlockOverride,
  ][]) {
    if (props[prop] !== '1') continue;
    result = {
      opaque: override.opaque ?? result.opaque,
      emit: override.emit ?? override.light?.emit ?? result.emit,
      filter: override.light?.filter ?? result.filter,
      collision: override.collision ?? result.collision,
      textures: { ...result.textures, ...override.textures },
      shape: override.shape ?? result.shape,
    };
  }
  return result;
}

function combinations(props: readonly StateProp[]): Partial<Record<StateProp, string>>[] {
  let result: Partial<Record<StateProp, string>>[] = [{}];
  for (const prop of props) {
    const next: Partial<Record<StateProp, string>>[] = [];
    for (const partial of result) {
      for (const value of STATE_VALUES[prop]) next.push({ ...partial, [prop]: value });
    }
    result = next;
  }
  return result;
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

/** Quarter turns around +y from the default facing (north). */
function facingQuarterTurns(facing: string | undefined): number {
  switch (facing) {
    case 'e':
      return 1;
    case 's':
      return 2;
    case 'w':
      return 3;
    default:
      return 0;
  }
}

/** Rotates a 1/16 box clockwise (seen from above) around the block centre, `turns` quarter turns. */
export function rotateBoxY(box: Box16, turns: number): Box16 {
  let [x0, y0, z0, x1, y1, z1] = box;
  for (let i = 0; i < (turns & 3); i++) {
    // (x, z) → (16 − z, x): north (−z) side becomes east (+x).
    const nx0 = 16 - z1;
    const nx1 = 16 - z0;
    const nz0 = x0;
    const nz1 = x1;
    [x0, x1, z0, z1] = [nx0, nx1, nz0, nz1];
  }
  return [x0, y0, z0, x1, y1, z1];
}

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
