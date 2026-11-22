import { SECTIONS_PER_COLUMN } from './coords.ts';
import { Section } from './Section.ts';

/** A vertical stack of 8 sections plus per-column 2D data. */
export class Column {
  readonly cx: number;
  readonly cz: number;
  readonly sections: Section[];
  /** Highest non-air block + 1, per (x, z): index x | z << 5. */
  readonly heightmap = new Int16Array(1024);
  /** Biome id per (x, z). */
  readonly biomes = new Uint8Array(1024);

  constructor(cx: number, cz: number, air = 0) {
    this.cx = cx;
    this.cz = cz;
    this.sections = Array.from({ length: SECTIONS_PER_COLUMN }, () => new Section(air));
  }

  byteSize(): number {
    let total = this.heightmap.byteLength + this.biomes.byteLength;
    for (const section of this.sections) total += section.byteSize();
    return total;
  }
}
