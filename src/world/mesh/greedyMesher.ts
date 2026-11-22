import {
  FLAG_OPAQUE,
  PASS_CUTOUT,
  PASS_OPAQUE,
  PASS_TRANSLUCENT,
  type RawTables,
  SHAPE_BOXES,
  SHAPE_CROSS,
  SHAPE_CUBE,
  SHAPE_LIQUID,
} from '../../content/registry.ts';
import { SECTION_SIZE, SECTION_VOLUME } from '../coords.ts';
import { PADDED, PADDED_AREA, type PaddedVoxels, paddedIndex } from './padded.ts';
import { packW0, packW1, QUAD_WORDS } from './vertexFormat.ts';
import { ALL_CONNECTED, sectionConnectivity } from './visibility.ts';

/**
 * Section mesher (runs in workers). Full cubes are merged greedily per face direction and slice;
 * liquids, cross plants and box shapes are emitted per block. Three output passes:
 * opaque (no discard), cutout and translucent.
 */

export const PASS_COUNT = 3;

export interface PassMesh {
  /** Packed vertices, 4 per quad, 2 words per vertex. */
  readonly data: Uint32Array;
  readonly quads: number;
}

export interface SectionMesh {
  readonly passes: readonly [PassMesh, PassMesh, PassMesh];
  /** 15-bit face-to-face connectivity (cave culling). */
  readonly connectivity: number;
}

export interface MeshOptions {
  /** Disable greedy merging (tests compare merged and unmerged output). */
  readonly greedy?: boolean;
}

/** Face directions in registry order: +x, −x, +y, −y, +z, −z. */
const FACE_AXIS = [0, 0, 1, 1, 2, 2] as const;
const FACE_SIGN = [1, -1, 1, -1, 1, -1] as const;
const AXIS_STEP = [1, PADDED_AREA, PADDED] as const; // padded index step along x, y, z
const FACE_STEP = [1, -1, PADDED_AREA, -PADDED_AREA, PADDED, -PADDED] as const;
/** Padded index of local (0, 0, 0). */
const ORIGIN = 1 + PADDED + PADDED_AREA;

const AO_SIDE_FULL = 3;
const FACE_UP_INDEX = 2;
/** Liquid surfaces sit 2/16 below the block top. */
const LIQUID_DROP = 2;

class QuadBuffer {
  data = new Uint32Array(QUAD_WORDS * 256);
  quads = 0;

  reset(): void {
    this.quads = 0;
  }

  reserve(): number {
    const offset = this.quads * QUAD_WORDS;
    if (offset + QUAD_WORDS > this.data.length) {
      const next = new Uint32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.quads++;
    return offset;
  }

  take(): PassMesh {
    return { data: this.data.slice(0, this.quads * QUAD_WORDS), quads: this.quads };
  }
}

const buffers = [new QuadBuffer(), new QuadBuffer(), new QuadBuffer()];
const maskKey = new Uint32Array(SECTION_SIZE * SECTION_SIZE);
const maskA = new Uint32Array(SECTION_SIZE * SECTION_SIZE);
const maskB = new Uint32Array(SECTION_SIZE * SECTION_SIZE);
const cornerAo = new Uint8Array(4);
const cornerSky = new Uint8Array(4);
const cornerBlock = new Uint8Array(4);
const tmpPos = new Int32Array(3);
const tmpOrder = new Uint8Array(4);
const tmpAo = new Uint8Array(4);
const tmpBounds = new Int32Array(6);
const ORDER_POSITIVE = [0, 1, 2, 3] as const;
const ORDER_NEGATIVE = [0, 3, 2, 1] as const;

function passBuffer(pass: number): QuadBuffer | null {
  switch (pass) {
    case PASS_OPAQUE:
      return buffers[0]!;
    case PASS_CUTOUT:
      return buffers[1]!;
    case PASS_TRANSLUCENT:
      return buffers[2]!;
    default:
      return null;
  }
}

/** Tint slot in the shader's colour table: 0 = none, else 1 + biome × 3 + (channel − 1). */
export function tintIndex(channel: number, biome: number): number {
  return channel === 0 ? 0 : 1 + biome * 3 + channel - 1;
}

function biomeAt(voxels: PaddedVoxels, p: number): number {
  // p = x + 1 + (z + 1) * PADDED + (y + 1) * PADDED_AREA → drop the y term.
  return voxels.biomes[p % PADDED_AREA]!;
}

/** Whether the face of `id` towards neighbour `nid` is visible. */
function faceVisible(tables: RawTables, id: number, nid: number): boolean {
  if ((tables.flags[nid]! & FLAG_OPAQUE) !== 0) return false;
  const group = tables.cullGroup[id]!;
  return group === 0 || group !== tables.cullGroup[nid]!;
}

/**
 * AO and smooth light for the 4 corners of the face of the cell at padded index `p`, facing `face`.
 * Corners are in canonical (u, v) order: (0,0), (1,0), (1,1), (0,1).
 */
function computeCorners(voxels: PaddedVoxels, tables: RawTables, p: number, face: number): void {
  const { ids, light } = voxels;
  const axis = FACE_AXIS[face]!;
  const u = (axis + 1) % 3;
  const v = (axis + 2) % 3;
  const front = p + FACE_STEP[face]!;
  const du = AXIS_STEP[u]!;
  const dv = AXIS_STEP[v]!;
  for (let c = 0; c < 4; c++) {
    const su = c === 1 || c === 2 ? du : -du;
    const sv = c >= 2 ? dv : -dv;
    const side1 = front + su;
    const side2 = front + sv;
    const corner = front + su + sv;
    const o1 = (tables.flags[ids[side1]!]! & FLAG_OPAQUE) !== 0 ? 1 : 0;
    const o2 = (tables.flags[ids[side2]!]! & FLAG_OPAQUE) !== 0 ? 1 : 0;
    const oc = (tables.flags[ids[corner]!]! & FLAG_OPAQUE) !== 0 ? 1 : 0;
    cornerAo[c] = o1 && o2 ? 0 : AO_SIDE_FULL - (o1 + o2 + oc);
    // Smooth light: average of the non-opaque cells around the vertex, scaled to 4 samples.
    const lf = light[front]!;
    let sky = lf >> 4;
    let blk = lf & 15;
    let count = 1;
    if (!o1) {
      const l = light[side1]!;
      sky += l >> 4;
      blk += l & 15;
      count++;
    }
    if (!o2) {
      const l = light[side2]!;
      sky += l >> 4;
      blk += l & 15;
      count++;
    }
    if (!oc && !(o1 && o2)) {
      const l = light[corner]!;
      sky += l >> 4;
      blk += l & 15;
      count++;
    }
    cornerSky[c] = ((sky * 4 + (count >> 1)) / count) | 0;
    cornerBlock[c] = ((blk * 4 + (count >> 1)) / count) | 0;
  }
}

/** Writes one quad. `corners` give the (u, v) corner of each vertex in emission order. */
function emitQuad(
  buffer: QuadBuffer,
  face: number,
  plane: number,
  drop: number,
  u0: number,
  v0: number,
  width: number,
  height: number,
  w1Base: number,
  a: number,
  b: number,
): void {
  const axis = FACE_AXIS[face]!;
  const u = (axis + 1) % 3;
  const v = (axis + 2) % 3;
  const positive = FACE_SIGN[face]! > 0;
  tmpAo[0] = a & 3;
  tmpAo[1] = (a >>> 2) & 3;
  tmpAo[2] = (a >>> 4) & 3;
  tmpAo[3] = (a >>> 6) & 3;
  // Emission order (CCW seen from outside): positive faces 0,1,2,3; negative faces 0,3,2,1.
  const base = positive ? ORDER_POSITIVE : ORDER_NEGATIVE;
  // Flip the diagonal when the default one (v0–v2) joins the darker corners.
  const flip = tmpAo[base[0]]! + tmpAo[base[2]]! < tmpAo[base[1]]! + tmpAo[base[3]]!;
  for (let i = 0; i < 4; i++) tmpOrder[i] = base[(i + (flip ? 1 : 0)) & 3]!;
  const offset = buffer.reserve();
  const data = buffer.data;
  for (let i = 0; i < 4; i++) {
    const c = tmpOrder[i]!;
    const cu = c === 1 || c === 2 ? width : 0;
    const cv = c >= 2 ? height : 0;
    tmpPos[axis] = plane * 16 - drop;
    tmpPos[u] = (u0 + cu) * 16;
    tmpPos[v] = (v0 + cv) * 16;
    const sky = (a >>> (8 + c * 6)) & 63;
    const blk = (b >>> (c * 6)) & 63;
    data[offset + i * 2] = packW0(tmpPos[0]!, tmpPos[1]!, tmpPos[2]!, tmpAo[c]!);
    data[offset + i * 2 + 1] = (w1Base | (sky << 12) | (blk << 18)) >>> 0;
  }
}

/** Meshes the padded copy of one section. */
export function meshSection(
  voxels: PaddedVoxels,
  tables: RawTables,
  options: MeshOptions = {},
): SectionMesh {
  const greedy = options.greedy ?? true;
  for (const buffer of buffers) buffer.reset();
  const summary = summarize(voxels.ids, tables);
  // A fully opaque interior can only show faces on its 6 boundary slices.
  if (summary.renderable) meshCubes(voxels, tables, greedy, summary.opaque === SECTION_VOLUME);
  if (summary.shapes) meshShapes(voxels, tables);
  const connectivity =
    summary.opaque === SECTION_VOLUME
      ? 0
      : summary.opaque === 0
        ? ALL_CONNECTED
        : sectionConnectivity(voxels.ids, tables);
  return { passes: [buffers[0]!.take(), buffers[1]!.take(), buffers[2]!.take()], connectivity };
}

const summaryResult = { renderable: false, shapes: false, opaque: 0 };

/** One pass over the 32³ interior: anything to draw, any shaped block, how many opaque cells. */
function summarize(ids: Uint16Array, tables: RawTables): typeof summaryResult {
  let renderable = false;
  let shapes = false;
  let opaque = 0;
  for (let y = 0; y < SECTION_SIZE; y++) {
    for (let z = 0; z < SECTION_SIZE; z++) {
      let p = ORIGIN + y * PADDED_AREA + z * PADDED;
      for (let x = 0; x < SECTION_SIZE; x++, p++) {
        const id = ids[p]!;
        if ((tables.flags[id]! & FLAG_OPAQUE) !== 0) opaque++;
        if (tables.pass[id] !== 0) {
          renderable = true;
          if (tables.shape[id] !== SHAPE_CUBE) shapes = true;
        }
      }
    }
  }
  summaryResult.renderable = renderable;
  summaryResult.shapes = shapes;
  summaryResult.opaque = opaque;
  return summaryResult;
}

function meshCubes(
  voxels: PaddedVoxels,
  tables: RawTables,
  greedy: boolean,
  boundaryOnly: boolean,
): void {
  const { ids } = voxels;
  const n = SECTION_SIZE;
  for (let face = 0; face < 6; face++) {
    const axis = FACE_AXIS[face]!;
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const step = FACE_STEP[face]!;
    const positive = FACE_SIGN[face]! > 0;
    for (let w = 0; w < n; w++) {
      if (boundaryOnly && w !== (positive ? n - 1 : 0)) continue;
      // Build the 32×32 mask of visible faces in this slice.
      let any = false;
      const slice = ORIGIN + w * AXIS_STEP[axis]!;
      const du = AXIS_STEP[u]!;
      const dv = AXIS_STEP[v]!;
      for (let vv = 0; vv < n; vv++) {
        const row = slice + vv * dv;
        for (let uu = 0; uu < n; uu++) {
          const p = row + uu * du;
          const id = ids[p]!;
          const m = uu + vv * n;
          maskKey[m] = 0;
          const shape = tables.shape[id]!;
          const pass = tables.pass[id]!;
          let lowered = 0;
          if (shape === SHAPE_CUBE) {
            if (pass === 0 || !faceVisible(tables, id, ids[p + step]!)) continue;
          } else if (shape === SHAPE_LIQUID && face === FACE_UP_INDEX) {
            // Liquid surfaces are merged too: shown 2/16 lower unless the same liquid is above.
            const group = tables.cullGroup[id]!;
            if (group !== 0 && tables.cullGroup[ids[p + step]!] === group) continue;
            lowered = 1;
          } else {
            continue;
          }
          computeCorners(voxels, tables, p, face);
          const fi = id * 6 + face;
          maskKey[m] =
            ((1 << 31) |
              tables.faceLayer[fi]! |
              (tintIndex(tables.faceTint[fi]!, biomeAt(voxels, p)) << 9) |
              (tables.faceFlags[fi]! << 14) |
              (pass << 17) |
              (lowered << 19)) >>>
            0;
          maskA[m] =
            (cornerAo[0]! |
              (cornerAo[1]! << 2) |
              (cornerAo[2]! << 4) |
              (cornerAo[3]! << 6) |
              (cornerSky[0]! << 8) |
              (cornerSky[1]! << 14) |
              (cornerSky[2]! << 20) |
              (cornerSky[3]! << 26)) >>>
            0;
          maskB[m] =
            (cornerBlock[0]! |
              (cornerBlock[1]! << 6) |
              (cornerBlock[2]! << 12) |
              (cornerBlock[3]! << 18)) >>>
            0;
          any = true;
        }
      }
      if (!any) continue;
      const plane = positive ? w + 1 : w;
      // Greedy merge: extend along u, then along v while whole rows match.
      for (let vv = 0; vv < n; vv++) {
        for (let uu = 0; uu < n; ) {
          const m = uu + vv * n;
          const key = maskKey[m]!;
          if (key === 0) {
            uu++;
            continue;
          }
          const a = maskA[m]!;
          const b = maskB[m]!;
          let width = 1;
          if (greedy) {
            while (
              uu + width < n &&
              maskKey[m + width] === key &&
              maskA[m + width] === a &&
              maskB[m + width] === b
            ) {
              width++;
            }
          }
          let height = 1;
          if (greedy) {
            outer: while (vv + height < n) {
              const row = m + height * n;
              for (let k = 0; k < width; k++) {
                if (maskKey[row + k] !== key || maskA[row + k] !== a || maskB[row + k] !== b)
                  break outer;
              }
              height++;
            }
          }
          for (let dv = 0; dv < height; dv++) maskKey.fill(0, m + dv * n, m + dv * n + width);
          const pass = (key >>> 17) & 3;
          const buffer = passBuffer(pass)!;
          const layer = key & 511;
          const tint = (key >>> 9) & 31;
          const flags = (key >>> 14) & 7;
          const w1Base = packW1(layer, face, 0, 0, tint, flags);
          const drop = (key >>> 19) & 1 ? LIQUID_DROP : 0;
          emitQuad(buffer, face, plane, drop, uu, vv, width, height, w1Base, a, b);
          uu += width;
        }
      }
    }
  }
}

/** Liquids, cross plants and box shapes, emitted per block. */
function meshShapes(voxels: PaddedVoxels, tables: RawTables): void {
  const { ids, light } = voxels;
  const n = SECTION_SIZE;
  for (let y = 0; y < n; y++) {
    for (let z = 0; z < n; z++) {
      let p = paddedIndex(0, y, z);
      for (let x = 0; x < n; x++, p++) {
        const id = ids[p]!;
        const shape = tables.shape[id]!;
        if (shape === SHAPE_CUBE || shape === 0) continue;
        const buffer = passBuffer(tables.pass[id]!);
        if (!buffer) continue;
        if (shape === SHAPE_LIQUID) meshLiquid(voxels, tables, buffer, p, id, x, y, z);
        else if (shape === SHAPE_CROSS)
          meshCross(tables, buffer, id, light[p]!, biomeAt(voxels, p), x, y, z);
        else if (shape === SHAPE_BOXES) meshBoxes(voxels, tables, buffer, p, id, x, y, z);
      }
    }
  }
}

function meshLiquid(
  voxels: PaddedVoxels,
  tables: RawTables,
  buffer: QuadBuffer,
  p: number,
  id: number,
  x: number,
  y: number,
  z: number,
): void {
  const { ids } = voxels;
  const group = tables.cullGroup[id]!;
  const above = ids[p + PADDED_AREA]!;
  const top = group !== 0 && tables.cullGroup[above] === group ? 16 : 16 - LIQUID_DROP;
  for (let face = 0; face < 6; face++) {
    if (face === FACE_UP_INDEX) continue;
    if (!faceVisible(tables, id, ids[p + FACE_STEP[face]!]!)) continue;
    computeCorners(voxels, tables, p, face);
    const fi = id * 6 + face;
    const w1Base = packW1(
      tables.faceLayer[fi]!,
      face,
      0,
      0,
      tintIndex(tables.faceTint[fi]!, biomeAt(voxels, p)),
      tables.faceFlags[fi]!,
    );
    tmpBounds[0] = x * 16;
    tmpBounds[1] = y * 16;
    tmpBounds[2] = z * 16;
    tmpBounds[3] = x * 16 + 16;
    tmpBounds[4] = y * 16 + top;
    tmpBounds[5] = z * 16 + 16;
    emitBox(buffer, face, tmpBounds, w1Base, true);
  }
}

function meshCross(
  tables: RawTables,
  buffer: QuadBuffer,
  id: number,
  cellLight: number,
  biome: number,
  x: number,
  y: number,
  z: number,
): void {
  const sky = (cellLight >> 4) * 4;
  const blk = (cellLight & 15) * 4;
  const x0 = x * 16;
  const y0 = y * 16;
  const z0 = z * 16;
  const fi = id * 6;
  for (let k = 0; k < 2; k++) {
    const w1 = packW1(
      tables.faceLayer[fi]!,
      6 + k,
      sky,
      blk,
      tintIndex(tables.faceTint[fi]!, biome),
      tables.faceFlags[fi]!,
    );
    const ax = k === 0 ? x0 : x0 + 16;
    const bx = k === 0 ? x0 + 16 : x0;
    const offset = buffer.reserve();
    const data = buffer.data;
    data[offset] = packW0(ax, y0, z0, 0);
    data[offset + 2] = packW0(bx, y0, z0 + 16, 1);
    data[offset + 4] = packW0(bx, y0 + 16, z0 + 16, 2);
    data[offset + 6] = packW0(ax, y0 + 16, z0, 3);
    data[offset + 1] = w1;
    data[offset + 3] = w1;
    data[offset + 5] = w1;
    data[offset + 7] = w1;
  }
}

function meshBoxes(
  voxels: PaddedVoxels,
  tables: RawTables,
  buffer: QuadBuffer,
  p: number,
  id: number,
  x: number,
  y: number,
  z: number,
): void {
  const { ids, light } = voxels;
  const cellLight = light[p]!;
  const sky = (cellLight >> 4) * 4;
  const blk = (cellLight & 15) * 4;
  const boxes = tables.boxShapes[tables.boxShape[id]!] ?? [];
  for (const box of boxes) {
    const [bx0, by0, bz0, bx1, by1, bz1] = box;
    tmpBounds[0] = x * 16 + bx0;
    tmpBounds[1] = y * 16 + by0;
    tmpBounds[2] = z * 16 + bz0;
    tmpBounds[3] = x * 16 + bx1;
    tmpBounds[4] = y * 16 + by1;
    tmpBounds[5] = z * 16 + bz1;
    for (let face = 0; face < 6; face++) {
      const onBoundary =
        (face === 0 && bx1 === 16) ||
        (face === 1 && bx0 === 0) ||
        (face === 2 && by1 === 16) ||
        (face === 3 && by0 === 0) ||
        (face === 4 && bz1 === 16) ||
        (face === 5 && bz0 === 0);
      if (onBoundary && (tables.flags[ids[p + FACE_STEP[face]!]!]! & FLAG_OPAQUE) !== 0) continue;
      const fi = id * 6 + face;
      const w1 = packW1(
        tables.faceLayer[fi]!,
        face,
        sky,
        blk,
        tintIndex(tables.faceTint[fi]!, biomeAt(voxels, p)),
        tables.faceFlags[fi]!,
      );
      emitBox(buffer, face, tmpBounds, w1, false);
    }
  }
}

/**
 * Emits one face of an axis-aligned box given in 1/16 units. With `smooth`, light and AO come
 * from the last `computeCorners` call; otherwise `w1` already carries flat light and AO is full.
 */
function emitBox(
  buffer: QuadBuffer,
  face: number,
  bounds: Int32Array,
  w1: number,
  smooth: boolean,
): void {
  const axis = FACE_AXIS[face]!;
  const u = (axis + 1) % 3;
  const v = (axis + 2) % 3;
  const positive = FACE_SIGN[face]! > 0;
  const plane = positive ? bounds[axis + 3]! : bounds[axis]!;
  const base = positive ? ORDER_POSITIVE : ORDER_NEGATIVE;
  // Same AO-driven diagonal choice as merged quads (smooth faces only; flat ones have full AO).
  const flip =
    smooth && cornerAo[base[0]]! + cornerAo[base[2]]! < cornerAo[base[1]]! + cornerAo[base[3]]!;
  for (let i = 0; i < 4; i++) tmpOrder[i] = base[(i + (flip ? 1 : 0)) & 3]!;
  const offset = buffer.reserve();
  for (let i = 0; i < 4; i++) {
    const c = tmpOrder[i]!;
    tmpPos[axis] = plane;
    tmpPos[u] = c === 1 || c === 2 ? bounds[u + 3]! : bounds[u]!;
    tmpPos[v] = c >= 2 ? bounds[v + 3]! : bounds[v]!;
    let word1 = w1;
    let ao = AO_SIDE_FULL;
    if (smooth) {
      ao = cornerAo[c]!;
      word1 = (w1 | (cornerSky[c]! << 12) | (cornerBlock[c]! << 18)) >>> 0;
    }
    buffer.data[offset + i * 2] = packW0(tmpPos[0]!, tmpPos[1]!, tmpPos[2]!, ao);
    buffer.data[offset + i * 2 + 1] = word1;
  }
}
