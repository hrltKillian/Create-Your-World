import type { RawTables } from '../../content/registry.ts';
import type { Column } from '../Column.ts';
import { columnIndex, localIndex, SECTION_SIZE, SECTION_VOLUME, WORLD_HEIGHT } from '../coords.ts';
import { BLOCK_SHIFT, FULL_SKY, SKY_SHIFT } from '../light.ts';
import { LightEngine } from './LightEngine.ts';

/** Per (x, z): lowest y from which the sky is open (only filter-0 blocks above), 256 if none. */
const skyFloor = new Int16Array(SECTION_SIZE * SECTION_SIZE);
/** A one-column engine reused by every call with the same tables (one per worker). */
let engine: LightEngine | null = null;
let engineTables: RawTables | null = null;

/**
 * Light of a column on its own (docs « Éclairage », worker side): sky light falls straight down to
 * the first block that filters it, then a flood from the sky edges and the emitters spreads both
 * channels. Outside the column counts as opaque, so the result is never brighter than the truth;
 * the LightEngine stitches the seams once the neighbours are loaded.
 */
export function columnLight(column: Column, tables: RawTables): void {
  if (engine === null || engineTables !== tables) {
    engine = new LightEngine(tables);
    engineTables = tables;
  }
  for (const section of column.sections) {
    section.light = null;
    section.uniformLight = 0;
  }
  openSky(column, tables.lightFilter);
  engine.addColumn(column);
  try {
    seedSkyEdges(engine, column);
    seedEmitters(engine, column, tables.emit);
    engine.flush();
  } finally {
    engine.removeColumn(column.cx, column.cz);
  }
  for (const section of column.sections) section.compact();
}

/**
 * Finds the sky floors and gives full sky light to every cell above them; the sections above the
 * highest floor stay uniform.
 */
function openSky(column: Column, filter: Uint8Array): void {
  const sections = column.sections;
  // Sections of filter-0 blocks only (air) need no scan.
  let top = sections.length - 1;
  while (top >= 0 && sections[top]!.blocks === null && filter[sections[top]!.uniformBlock] === 0)
    top--;
  let highest = 0;
  for (let c = 0; c < skyFloor.length; c++) {
    const lx = c & 31;
    const lz = c >> 5;
    let y = (top + 1) * SECTION_SIZE - 1;
    while (y >= 0 && filter[blockAt(column, lx, y, lz)] === 0) y--;
    skyFloor[c] = y + 1;
    if (y + 1 > highest) highest = y + 1;
  }
  for (let sy = 0; sy < sections.length; sy++) {
    const section = sections[sy]!;
    const bottom = sy * SECTION_SIZE;
    if (bottom >= highest) {
      section.uniformLight = FULL_SKY;
      continue;
    }
    for (let c = 0; c < skyFloor.length; c++) {
      const lx = c & 31;
      const lz = c >> 5;
      for (let y = Math.max(skyFloor[c]!, bottom); y < bottom + SECTION_SIZE; y++)
        section.setLight(localIndex(lx, y & 31, lz), FULL_SKY);
    }
  }
}

/**
 * Seeds the open cells next to a darker cell of the column: the lowest one (it lights the block
 * below it) and those facing a neighbour whose sky floor is higher.
 */
function seedSkyEdges(engine: LightEngine, column: Column): void {
  for (let c = 0; c < skyFloor.length; c++) {
    const floor = skyFloor[c]!;
    if (floor >= WORLD_HEIGHT) continue;
    const lx = c & 31;
    const lz = c >> 5;
    let edge = floor;
    if (lx > 0) edge = Math.max(edge, skyFloor[columnIndex(lx - 1, lz)]! - 1);
    if (lx < 31) edge = Math.max(edge, skyFloor[columnIndex(lx + 1, lz)]! - 1);
    if (lz > 0) edge = Math.max(edge, skyFloor[columnIndex(lx, lz - 1)]! - 1);
    if (lz < 31) edge = Math.max(edge, skyFloor[columnIndex(lx, lz + 1)]! - 1);
    const last = Math.min(edge, WORLD_HEIGHT - 1);
    for (let y = floor; y <= last; y++) engine.seed(column, localIndex(lx, y, lz), SKY_SHIFT);
  }
}

/** Seeds every emitting block (the flood gives each its own level first). */
function seedEmitters(engine: LightEngine, column: Column, emit: Uint8Array): void {
  for (let sy = 0; sy < column.sections.length; sy++) {
    const section = column.sections[sy]!;
    const blocks = section.blocks;
    if (blocks === null) {
      if (emit[section.uniformBlock] === 0) continue;
      for (let i = 0; i < SECTION_VOLUME; i++) engine.seed(column, (sy << 15) | i, BLOCK_SHIFT);
      continue;
    }
    for (let i = 0; i < blocks.length; i++)
      if (emit[blocks[i]!] !== 0) engine.seed(column, (sy << 15) | i, BLOCK_SHIFT);
  }
}

function blockAt(column: Column, lx: number, y: number, lz: number): number {
  return column.sections[y >> 5]!.getBlock(localIndex(lx, y & 31, lz));
}
