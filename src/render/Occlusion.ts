import { SECTIONS_PER_COLUMN, sectionKey } from '../world/coords.ts';
import { ALL_CONNECTED, pairBit } from '../world/mesh/visibility.ts';

/**
 * Cave occlusion culling (docs « Ordre de rendu et culling »): a breadth-first walk over the
 * sections from the camera's own, through the 15-bit face-to-face connectivity masks of the
 * mesher (`world/mesh/visibility.ts`). A section is visible once the walk enters it; the others
 * are hidden (`visible = false` on their meshes, ChunkMeshes).
 *
 * The walk never steps back towards the camera's section along an axis, so every path is
 * monotone like a line of sight: the result does not depend on where the camera looks, and it is
 * walked again only when the camera changes section, the radius changes, or a mask within it
 * changes (`changed`), at most once per `update` (once per frame). A section without a mask (its
 * mesh pending, empty, or not loaded) counts as fully connected.
 */

/** Largest render distance (`?rd=` ≤ 12) plus the ring of columns still meshed beyond it. */
const MAX_REACH = 13;
const SIDE = 2 * MAX_REACH + 1;
const CELLS = SIDE * SIDE * SECTIONS_PER_COLUMN;
/** Entry "face" of the camera's own section: every face is an exit. */
const START = 6;
/** Grid strides of the faces 0 +x, 1 −x, 2 +y, 3 −y, 4 +z, 5 −z (the opposite of f is f ^ 1). */
const STRIDE_X = SECTIONS_PER_COLUMN;
const STRIDE_Z = SIDE * SECTIONS_PER_COLUMN;
const STEP = [STRIDE_X, -STRIDE_X, 1, -1, STRIDE_Z, -STRIDE_Z] as const;
/** Mask bit of each (entry face, exit face) pair; 0 when they are the same face. */
const PAIR = new Uint16Array(36);
for (let a = 0; a < 6; a++)
  for (let b = 0; b < 6; b++) PAIR[a * 6 + b] = a === b ? 0 : 1 << pairBit(a, b);

export interface OcclusionStats {
  readonly enabled: boolean;
  /** Walks so far. */
  readonly runs: number;
  /** Sections the last walk entered. */
  readonly reached: number;
  /** Wall time of the last walk (ms). */
  readonly lastMs: number;
}

export class Occlusion {
  /** Entry faces of each grid cell in the last walk (bit 6: the camera's section); 0: hidden. */
  private readonly seen = new Uint8Array(CELLS);
  /** Masks of the cells read by the last walk (−1: not read yet). */
  private readonly maskOf = new Int32Array(CELLS);
  /** Queue of the walk: a cell and the face it was entered through (at most 6 entries a cell). */
  private readonly queueCell = new Int32Array(CELLS * 6);
  private readonly queueFace = new Uint8Array(CELLS * 6);
  private enabled = true;
  /** The last walk applies (enabled, and the camera inside the world's height). */
  private active = false;
  private dirty = true;
  /** Camera section and reach (columns) of the last walk. */
  private cx = Number.NaN;
  private sy = Number.NaN;
  private cz = Number.NaN;
  private reach = 0;
  private runs = 0;
  private reached = 0;
  private lastMs = 0;

  /** Turns the culling on or off (`?occlusion=0`, the xray view); every section shows when off. */
  setEnabled(on: boolean): void {
    if (on !== this.enabled) this.dirty = true;
    this.enabled = on;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** The mask of a section of column (cx, cz) changed: walk again if it lies within reach. */
  changed(cx: number, cz: number): void {
    if (Math.abs(cx - this.cx) <= this.reach && Math.abs(cz - this.cz) <= this.reach)
      this.dirty = true;
  }

  /**
   * Walks again from the camera at (x, y, z) when needed (see the class comment); returns whether
   * it did, so the caller applies the new visibility. `masks`: by section key.
   */
  update(
    x: number,
    y: number,
    z: number,
    renderDistance: number,
    masks: ReadonlyMap<number, number>,
  ): boolean {
    const cx = Math.floor(x) >> 5;
    const sy = Math.floor(y) >> 5;
    const cz = Math.floor(z) >> 5;
    const reach = Math.min(MAX_REACH, renderDistance + 1);
    const active = this.enabled && sy >= 0 && sy < SECTIONS_PER_COLUMN;
    const moved = cx !== this.cx || sy !== this.sy || cz !== this.cz || reach !== this.reach;
    if (!this.dirty && !moved && active === this.active) return false;
    this.dirty = false;
    this.active = active;
    this.cx = cx;
    this.sy = sy;
    this.cz = cz;
    this.reach = reach;
    this.runs++;
    if (active) {
      const t0 = performance.now();
      this.walk(masks);
      this.lastMs = performance.now() - t0;
    }
    return true;
  }

  /** Whether the last walk shows a section (always, when off or outside the walked grid). */
  visible(cx: number, sy: number, cz: number): boolean {
    if (!this.active) return true;
    const dx = cx - this.cx;
    const dz = cz - this.cz;
    if (dx < -this.reach || dx > this.reach || dz < -this.reach || dz > this.reach) return true;
    if (sy < 0 || sy >= SECTIONS_PER_COLUMN) return true;
    return this.seen[cellOf(dx, sy, dz)] !== 0;
  }

  stats(): OcclusionStats {
    return { enabled: this.enabled, runs: this.runs, reached: this.reached, lastMs: this.lastMs };
  }

  /** The breadth-first walk (allocation-free: typed arrays reused across walks). */
  private walk(masks: ReadonlyMap<number, number>): void {
    const { seen, maskOf, queueCell, queueFace, reach } = this;
    seen.fill(0);
    maskOf.fill(-1);
    const start = cellOf(0, this.sy, 0);
    seen[start] = 1 << START;
    queueCell[0] = start;
    queueFace[0] = START;
    let head = 0;
    let tail = 1;
    let reached = 1;
    while (head < tail) {
      const cell = queueCell[head]!;
      const entry = queueFace[head]!;
      head++;
      const column = (cell / SECTIONS_PER_COLUMN) | 0;
      const sy = cell % SECTIONS_PER_COLUMN;
      const dx = (column % SIDE) - MAX_REACH;
      const dz = ((column / SIDE) | 0) - MAX_REACH;
      const mask = entry === START ? ALL_CONNECTED : this.maskAt(masks, cell, dx, sy, dz);
      for (let face = 0; face < 6; face++) {
        // Through the section: from the entry face to this exit face.
        if (entry !== START && (mask & PAIR[entry * 6 + face]!) === 0) continue;
        if (!this.forward(face, dx, sy, dz, reach)) continue;
        const next = cell + STEP[face]!;
        // The neighbour is entered through its face opposite to this one.
        const enteredBy = face ^ 1;
        const bit = 1 << enteredBy;
        const before = seen[next]!;
        if ((before & bit) !== 0) continue;
        if (before === 0) reached++;
        seen[next] = before | bit;
        queueCell[tail] = next;
        queueFace[tail] = enteredBy;
        tail++;
      }
    }
    this.reached = reached;
  }

  /**
   * A step through `face` from the cell at (dx, sy, dz) (offsets from the camera's section) stays
   * on the grid and never comes back towards the camera's section along that axis.
   */
  private forward(face: number, dx: number, sy: number, dz: number, reach: number): boolean {
    switch (face) {
      case 0:
        return dx >= 0 && dx < reach;
      case 1:
        return dx <= 0 && dx > -reach;
      case 2:
        return sy >= this.sy && sy < SECTIONS_PER_COLUMN - 1;
      case 3:
        return sy <= this.sy && sy > 0;
      case 4:
        return dz >= 0 && dz < reach;
      default:
        return dz <= 0 && dz > -reach;
    }
  }

  /** A cell's mask, read from `masks` once per walk (none: fully connected). */
  private maskAt(
    masks: ReadonlyMap<number, number>,
    cell: number,
    dx: number,
    sy: number,
    dz: number,
  ): number {
    let mask = this.maskOf[cell]!;
    if (mask < 0) {
      mask = masks.get(sectionKey(this.cx + dx, sy, this.cz + dz)) ?? ALL_CONNECTED;
      this.maskOf[cell] = mask;
    }
    return mask;
  }
}

/** Grid cell of a section at offsets (dx, dz) from the camera's column, at height sy. */
function cellOf(dx: number, sy: number, dz: number): number {
  return ((dz + MAX_REACH) * SIDE + dx + MAX_REACH) * SECTIONS_PER_COLUMN + sy;
}
