/** Uniform grid over the x/z plane for neighbour queries (cell size in blocks). */
export class SpatialHash {
  private readonly cellSize: number;
  private readonly cells = new Map<number, Set<number>>();
  private readonly cellOf = new Map<number, number>();

  constructor(cellSize = 8) {
    this.cellSize = cellSize;
  }

  private key(x: number, z: number): number {
    const cx = Math.floor(x / this.cellSize) + 0x100000;
    const cz = Math.floor(z / this.cellSize) + 0x100000;
    return cx * 0x200000 + cz;
  }

  /** Inserts or moves an entity. */
  update(id: number, x: number, z: number): void {
    const key = this.key(x, z);
    const current = this.cellOf.get(id);
    if (current === key) return;
    if (current !== undefined) this.cells.get(current)?.delete(id);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = new Set();
      this.cells.set(key, cell);
    }
    cell.add(id);
    this.cellOf.set(id, key);
  }

  remove(id: number): void {
    const current = this.cellOf.get(id);
    if (current === undefined) return;
    const cell = this.cells.get(current);
    cell?.delete(id);
    if (cell && cell.size === 0) this.cells.delete(current);
    this.cellOf.delete(id);
  }

  /** Ids in cells overlapping the square of half-size `radius` (caller filters exact distance). */
  query(x: number, z: number, radius: number, out: number[]): number[] {
    out.length = 0;
    const s = this.cellSize;
    for (let gx = Math.floor((x - radius) / s); gx <= Math.floor((x + radius) / s); gx++) {
      for (let gz = Math.floor((z - radius) / s); gz <= Math.floor((z + radius) / s); gz++) {
        const cell = this.cells.get((gx + 0x100000) * 0x200000 + (gz + 0x100000));
        if (cell) for (const id of cell) out.push(id);
      }
    }
    return out;
  }
}
