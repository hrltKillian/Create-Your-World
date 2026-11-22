import { SECTION_VOLUME } from './coords.ts';

/**
 * 32³ voxels. Blocks and light are stored lazily and independently: a uniform section keeps a
 * single value instead of an array, and promotes to an array on the first differing write.
 * Light packs sky light in the high nibble and block light in the low nibble.
 */
export class Section {
  blocks: Uint16Array | null = null;
  uniformBlock: number;
  light: Uint8Array | null = null;
  uniformLight: number;
  /** Bumped on every change; meshes and saves compare versions. */
  version = 0;

  constructor(uniformBlock = 0, uniformLight = 0xf0) {
    this.uniformBlock = uniformBlock;
    this.uniformLight = uniformLight;
  }

  getBlock(index: number): number {
    return this.blocks ? this.blocks[index]! : this.uniformBlock;
  }

  setBlock(index: number, state: number): void {
    if (!this.blocks) {
      if (state === this.uniformBlock) return;
      this.blocks = new Uint16Array(SECTION_VOLUME).fill(this.uniformBlock);
    }
    if (this.blocks[index] !== state) {
      this.blocks[index] = state;
      this.version++;
    }
  }

  getLight(index: number): number {
    return this.light ? this.light[index]! : this.uniformLight;
  }

  setLight(index: number, value: number): void {
    if (!this.light) {
      if (value === this.uniformLight) return;
      this.light = new Uint8Array(SECTION_VOLUME).fill(this.uniformLight);
    }
    this.light[index] = value;
  }

  /** Fills every voxel with one state (keeps the section uniform). */
  fill(state: number): void {
    this.blocks = null;
    this.uniformBlock = state;
    this.version++;
  }

  /** Drops the arrays that became uniform again (called after meshing). */
  compact(): void {
    if (this.blocks && isUniform16(this.blocks)) {
      this.uniformBlock = this.blocks[0]!;
      this.blocks = null;
    }
    if (this.light && isUniform8(this.light)) {
      this.uniformLight = this.light[0]!;
      this.light = null;
    }
  }

  isEmpty(air: number): boolean {
    return this.blocks === null && this.uniformBlock === air;
  }

  /** Bytes held by arrays (uniform sections cost nothing). */
  byteSize(): number {
    return (this.blocks?.byteLength ?? 0) + (this.light?.byteLength ?? 0);
  }
}

function isUniform16(a: Uint16Array): boolean {
  const first = a[0]!;
  for (let i = 1; i < a.length; i++) if (a[i] !== first) return false;
  return true;
}

function isUniform8(a: Uint8Array): boolean {
  const first = a[0]!;
  for (let i = 1; i < a.length; i++) if (a[i] !== first) return false;
  return true;
}
