/**
 * Uniform grid over the x/z plane for neighbour queries, stored in typed arrays: entities are
 * linked into hashed buckets, each entry remembering its exact cell so bucket collisions never
 * return wrong cells or duplicates. No allocation on update, remove or query once warmed up.
 * Results come sorted by id: they do not depend on the order entities were linked in (a restored
 * world links them in id order), so what callers do in that order survives a save and reload.
 */
export class SpatialHash {
  private readonly cellSize: number;
  private readonly mask: number;
  /** First slot of each bucket (−1: empty). */
  private readonly head: Int32Array;
  private capacity = 0;
  private ids = new Float64Array(0);
  private next = new Int32Array(0);
  private prev = new Int32Array(0);
  private cellX = new Int32Array(0);
  private cellZ = new Int32Array(0);
  private bucketOf = new Int32Array(0);
  private freeHead = -1;
  private used = 0;
  private readonly slotOf = new Map<number, number>();

  /** `buckets` must be a power of two. */
  constructor(cellSize = 8, buckets = 1024) {
    if ((buckets & (buckets - 1)) !== 0) throw new Error('buckets must be a power of two');
    this.cellSize = cellSize;
    this.mask = buckets - 1;
    this.head = new Int32Array(buckets).fill(-1);
    this.grow(64);
  }

  get size(): number {
    return this.slotOf.size;
  }

  /** Inserts or moves an entity. */
  update(id: number, x: number, z: number): void {
    const gx = Math.floor(x / this.cellSize);
    const gz = Math.floor(z / this.cellSize);
    let slot = this.slotOf.get(id);
    if (slot !== undefined) {
      if (this.cellX[slot] === gx && this.cellZ[slot] === gz) return;
      this.unlink(slot);
    } else {
      slot = this.allocate();
      this.ids[slot] = id;
      this.slotOf.set(id, slot);
    }
    this.cellX[slot] = gx;
    this.cellZ[slot] = gz;
    this.link(slot, this.bucket(gx, gz));
  }

  remove(id: number): void {
    const slot = this.slotOf.get(id);
    if (slot === undefined) return;
    this.unlink(slot);
    this.slotOf.delete(id);
    this.next[slot] = this.freeHead;
    this.freeHead = slot;
  }

  /**
   * Ids in cells overlapping the square of half-size `radius`, ascending (caller filters exact
   * distance).
   */
  query(x: number, z: number, radius: number, out: number[]): number[] {
    // Written by index and cut to length last: `out.length = 0` would make V8 drop the array's
    // backing store, and every query that finds something allocate a new one.
    let n = 0;
    const s = this.cellSize;
    const gx1 = Math.floor((x + radius) / s);
    const gz1 = Math.floor((z + radius) / s);
    for (let gx = Math.floor((x - radius) / s); gx <= gx1; gx++) {
      for (let gz = Math.floor((z - radius) / s); gz <= gz1; gz++) {
        const start = n;
        for (let slot = this.head[this.bucket(gx, gz)]!; slot >= 0; slot = this.next[slot]!) {
          if (this.cellX[slot] === gx && this.cellZ[slot] === gz) out[n++] = this.ids[slot]!;
        }
        // Buckets list newest first: reverse the cell's run so it is mostly ascending.
        for (let a = start, b = n - 1; a < b; a++, b--) {
          const t = out[a]!;
          out[a] = out[b]!;
          out[b] = t;
        }
      }
    }
    // Insertion sort, in place: near-linear on the mostly ascending runs above.
    for (let i = 1; i < n; i++) {
      const id = out[i]!;
      let j = i - 1;
      for (; j >= 0 && out[j]! > id; j--) out[j + 1] = out[j]!;
      out[j + 1] = id;
    }
    out.length = n;
    return out;
  }

  private bucket(gx: number, gz: number): number {
    return (Math.imul(gx, 73856093) ^ Math.imul(gz, 19349663)) & this.mask;
  }

  private link(slot: number, bucket: number): void {
    const first = this.head[bucket]!;
    this.prev[slot] = -1;
    this.next[slot] = first;
    if (first >= 0) this.prev[first] = slot;
    this.head[bucket] = slot;
    this.bucketOf[slot] = bucket;
  }

  private unlink(slot: number): void {
    const p = this.prev[slot]!;
    const n = this.next[slot]!;
    if (p >= 0) this.next[p] = n;
    else this.head[this.bucketOf[slot]!] = n;
    if (n >= 0) this.prev[n] = p;
  }

  private allocate(): number {
    if (this.freeHead >= 0) {
      const slot = this.freeHead;
      this.freeHead = this.next[slot]!;
      return slot;
    }
    if (this.used === this.capacity) this.grow(this.capacity * 2);
    return this.used++;
  }

  private grow(capacity: number): void {
    const copy = <T extends Int32Array | Float64Array>(old: T, make: (n: number) => T): T => {
      const fresh = make(capacity);
      fresh.set(old);
      return fresh;
    };
    this.ids = copy(this.ids, (n) => new Float64Array(n));
    this.next = copy(this.next, (n) => new Int32Array(n));
    this.prev = copy(this.prev, (n) => new Int32Array(n));
    this.cellX = copy(this.cellX, (n) => new Int32Array(n));
    this.cellZ = copy(this.cellZ, (n) => new Int32Array(n));
    this.bucketOf = copy(this.bucketOf, (n) => new Int32Array(n));
    this.capacity = capacity;
  }
}
