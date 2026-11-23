import { SECTIONS_PER_COLUMN } from './coords.ts';
import type { GenResult, SectionPayload } from './protocol.ts';
import { Section } from './Section.ts';

/** A vertical stack of 8 sections plus per-column 2D data. */
export class Column {
  readonly cx: number;
  readonly cz: number;
  readonly sections: Section[];
  /** Highest non-air block + 1, per (x, z): index `columnIndex(x, z)`. */
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

/** Plain payload of a column's sections (arrays are shared, not copied). */
export function sectionPayloads(column: Column): SectionPayload[] {
  return column.sections.map((s, sy) => ({
    sy,
    uniformBlock: s.uniformBlock,
    blocks: s.blocks,
    uniformLight: s.uniformLight,
    light: s.light,
  }));
}

/** Rebuilds a column from a generation result (takes ownership of its arrays). */
export function columnFromResult(result: GenResult, air: number): Column {
  const column = new Column(result.cx, result.cz, air);
  for (const payload of result.sections) {
    const section = column.sections[payload.sy]!;
    section.blocks = payload.blocks;
    section.uniformBlock = payload.uniformBlock;
    section.light = payload.light;
    section.uniformLight = payload.uniformLight;
  }
  column.heightmap.set(result.heightmap);
  column.biomes.set(result.biomes);
  return column;
}
