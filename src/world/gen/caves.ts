import type { CaveDef } from '../../content/schema.ts';
import { type Noise2, type Noise3, noise2, noise3 } from '../../core/noise.ts';
import type { Column } from '../Column.ts';
import { columnIndex, localIndex, SECTION_SIZE, WORLD_HEIGHT } from '../coords.ts';
import { bilerp } from './climate.ts';
import type { GenContext } from './generateColumn.ts';
import { heightAt, type LatticeCache } from './sample.ts';

/*
 * Caves (docs « Génération » step 5). Three 3D noises sampled on a world-anchored 4×4×4 lattice
 * and interpolated trilinearly: noodle tunnels where n1² + n2² is small, caverns where n3 is high.
 * `carveCaves` fills a whole column; `caveAt` answers for one cell with the same arithmetic, so
 * decoration (and anything else) can ask whether generation carves a cell without generating it.
 */

/** Lattice spacing in blocks, and its log2. */
const STEP = 4;
const STEP_BITS = 2;
/** Lattice points across a column (32 / 4 + 1). */
const SPAN = SECTION_SIZE / STEP + 1;
/** Lattice levels over the world height (256 / 4 + 1). */
const LEVELS = WORLD_HEIGHT / STEP + 1;
/** Caverns close over the last blocks of their band: that many blocks, threshold rise per block. */
const CAVERN_TAPER = 6;
const CAVERN_TAPER_STEP = 0.06;
/** Row length of the padded heights `carveCaves` reads (one block of margin on each side). */
export const PADDED = SECTION_SIZE + 2;

export interface CaveNoise {
  readonly def: CaveDef;
  readonly tunnelA: Noise3;
  readonly tunnelB: Noise3;
  readonly cavern: Noise3;
  readonly entrance: Noise2;
}

export function createCaveNoise(seed: string, def: CaveDef): CaveNoise {
  return {
    def,
    tunnelA: noise3(seed, 'caves.tunnelA'),
    tunnelB: noise3(seed, 'caves.tunnelB'),
    cavern: noise3(seed, 'caves.cavern'),
    entrance: noise2(seed, 'caves.entrance'),
  };
}

/** A noise at a lattice point (world lattice coordinates); `scale` is [horizontal, vertical]. */
function latticeNoise(
  noise: Noise3,
  scale: readonly [number, number],
  ix: number,
  iy: number,
  iz: number,
): number {
  return noise((ix * STEP) / scale[0], (iy * STEP) / scale[1], (iz * STEP) / scale[0]);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Whether interpolated noise values open a cell (`cavern` is only read inside cavernY). */
function opens(def: CaveDef, y: number, a: number, b: number, cavern: number): boolean {
  if (a * a + b * b < def.tunnelThreshold) return true;
  const edge = Math.min(y - def.cavernY[0], def.cavernY[1] - y);
  if (edge < 0) return false;
  // The threshold rises over the last blocks of the band, so caverns close into rounded floors and
  // ceilings instead of flat cuts.
  const closing = edge < CAVERN_TAPER ? (CAVERN_TAPER - edge) * CAVERN_TAPER_STEP : 0;
  return cavern > def.cavernThreshold + closing;
}

/**
 * Highest y caves may carve in a block column (< 1: none), from its surface height `h` and the
 * lowest of its own and its 4 neighbours' (`hMin`). Never under water; elsewhere at least
 * `surfaceMargin` blocks under `hMin`, so a cave never opens beside a lake. At entrances of dry
 * land, caves may reach the surface.
 */
function caveRoof(ctx: GenContext, x: number, z: number, h: number, hMin: number): number {
  const sea = ctx.def.seaLevel;
  if (h < sea) return -1;
  const def = ctx.caves.def;
  if (hMin >= sea) {
    const n = ctx.caves.entrance(x / def.entranceScale, z / def.entranceScale);
    if (n > def.entranceThreshold) return h;
  }
  return hMin - def.surfaceMargin;
}

/** The cell's state once carved: magma deep down, air elsewhere. */
function carvedState(ctx: GenContext, y: number): number {
  return y < ctx.def.magmaBelowY ? ctx.magma : ctx.registry.air;
}

/** Fills levels lo…hi of a lattice buffer (SPAN × SPAN columns of LEVELS) from a noise. */
function fillLattice(
  lattice: Float64Array,
  noise: Noise3,
  scale: readonly [number, number],
  ix0: number,
  iz0: number,
  lo: number,
  hi: number,
): void {
  for (let iz = 0; iz < SPAN; iz++) {
    for (let ix = 0; ix < SPAN; ix++) {
      const base = (iz * SPAN + ix) * LEVELS;
      for (let iy = lo; iy <= hi; iy++)
        lattice[base + iy] = latticeNoise(noise, scale, ix0 + ix, iy, iz0 + iz);
    }
  }
}

/** Level `iy` of a lattice buffer interpolated across x and z, from the corner at `corner`. */
function across(lattice: Float64Array, corner: number, iy: number, tx: number, tz: number): number {
  const i = corner + iy;
  return bilerp(
    lattice[i]!,
    lattice[i + LEVELS]!,
    lattice[i + SPAN * LEVELS]!,
    lattice[i + SPAN * LEVELS + LEVELS]!,
    tx,
    tz,
  );
}

// Scratch buffers of `carveCaves` (generation is synchronous: one set per worker).
const tunnelA = new Float64Array(SPAN * SPAN * LEVELS);
const tunnelB = new Float64Array(SPAN * SPAN * LEVELS);
const cavern = new Float64Array(SPAN * SPAN * LEVELS);
const levelA = new Float64Array(LEVELS);
const levelB = new Float64Array(LEVELS);
const levelC = new Float64Array(LEVELS);
const roofs = new Int16Array(SECTION_SIZE * SECTION_SIZE);

/**
 * Carves the caves of a column. `heights` holds the surface heights of the column and of a one
 * block margin around it (rows of PADDED, the column's cell (0, 0) at index PADDED + 1).
 */
export function carveCaves(ctx: GenContext, column: Column, heights: Int16Array): void {
  const def = ctx.caves.def;
  const x0 = column.cx * SECTION_SIZE;
  const z0 = column.cz * SECTION_SIZE;
  let maxRoof = 0;
  for (let lz = 0; lz < SECTION_SIZE; lz++) {
    for (let lx = 0; lx < SECTION_SIZE; lx++) {
      const i = (lz + 1) * PADDED + lx + 1;
      const h = heights[i]!;
      const hMin = Math.min(
        h,
        heights[i - 1]!,
        heights[i + 1]!,
        heights[i - PADDED]!,
        heights[i + PADDED]!,
      );
      const roof = caveRoof(ctx, x0 + lx, z0 + lz, h, hMin);
      roofs[columnIndex(lx, lz)] = roof;
      if (roof > maxRoof) maxRoof = roof;
    }
  }
  if (maxRoof < 1) return;

  // Lattice values, only up to the highest level a cell can read (and caverns only in their band).
  const top = (maxRoof >> STEP_BITS) + 1;
  const cavernLo = def.cavernY[0] >> STEP_BITS;
  const cavernHi = Math.min(top, (def.cavernY[1] >> STEP_BITS) + 1);
  const ix0 = x0 >> STEP_BITS;
  const iz0 = z0 >> STEP_BITS;
  fillLattice(tunnelA, ctx.caves.tunnelA, def.tunnelScale, ix0, iz0, 0, top);
  fillLattice(tunnelB, ctx.caves.tunnelB, def.tunnelScale, ix0, iz0, 0, top);
  fillLattice(cavern, ctx.caves.cavern, def.cavernScale, ix0, iz0, cavernLo, cavernHi);

  for (let lz = 0; lz < SECTION_SIZE; lz++) {
    for (let lx = 0; lx < SECTION_SIZE; lx++) {
      const roof = roofs[columnIndex(lx, lz)]!;
      if (roof < 1) continue;
      // Interpolate each lattice level across x and z once, then along y per cell.
      const tx = (lx & 3) / STEP;
      const tz = (lz & 3) / STEP;
      const corner = ((lz >> STEP_BITS) * SPAN + (lx >> STEP_BITS)) * LEVELS;
      const levels = (roof >> STEP_BITS) + 1;
      for (let iy = 0; iy <= levels; iy++) {
        levelA[iy] = across(tunnelA, corner, iy, tx, tz);
        levelB[iy] = across(tunnelB, corner, iy, tx, tz);
      }
      const hi = Math.min(levels, cavernHi);
      for (let iy = cavernLo; iy <= hi; iy++) levelC[iy] = across(cavern, corner, iy, tx, tz);
      for (let y = 1; y <= roof; y++) {
        const iy = y >> STEP_BITS;
        const ty = (y & 3) / STEP;
        const a = lerp(levelA[iy]!, levelA[iy + 1]!, ty);
        const b = lerp(levelB[iy]!, levelB[iy + 1]!, ty);
        const c = lerp(levelC[iy]!, levelC[iy + 1]!, ty);
        if (opens(def, y, a, b, c))
          column.sections[y >> 5]!.setBlock(localIndex(lx, y & 31, lz), carvedState(ctx, y));
      }
    }
  }
}

/** One noise at a cell, interpolated exactly as `carveCaves` does. */
function noiseAt(
  noise: Noise3,
  scale: readonly [number, number],
  x: number,
  y: number,
  z: number,
): number {
  const iy = y >> STEP_BITS;
  const below = levelAt(noise, scale, x, iy, z);
  return lerp(below, levelAt(noise, scale, x, iy + 1, z), (y & 3) / STEP);
}

/** Lattice level `iy` of a noise interpolated across x and z at a block column. */
function levelAt(
  noise: Noise3,
  scale: readonly [number, number],
  x: number,
  iy: number,
  z: number,
): number {
  const ix = x >> STEP_BITS;
  const iz = z >> STEP_BITS;
  return bilerp(
    latticeNoise(noise, scale, ix, iy, iz),
    latticeNoise(noise, scale, ix + 1, iy, iz),
    latticeNoise(noise, scale, ix, iy, iz + 1),
    latticeNoise(noise, scale, ix + 1, iy, iz + 1),
    (x & 3) / STEP,
    (z & 3) / STEP,
  );
}

/** Whether generation carves the cell (x, y, z) (into air or magma). Analytic, no generation. */
export function caveAt(
  ctx: GenContext,
  cache: LatticeCache,
  x: number,
  y: number,
  z: number,
): boolean {
  if (y < 1) return false;
  const h = heightAt(ctx, cache, x, z);
  if (y > h) return false;
  const hMin = Math.min(
    h,
    heightAt(ctx, cache, x - 1, z),
    heightAt(ctx, cache, x + 1, z),
    heightAt(ctx, cache, x, z - 1),
    heightAt(ctx, cache, x, z + 1),
  );
  if (y > caveRoof(ctx, x, z, h, hMin)) return false;
  const def = ctx.caves.def;
  const a = noiseAt(ctx.caves.tunnelA, def.tunnelScale, x, y, z);
  const b = noiseAt(ctx.caves.tunnelB, def.tunnelScale, x, y, z);
  const inBand = y >= def.cavernY[0] && y <= def.cavernY[1];
  const c = inBand ? noiseAt(ctx.caves.cavern, def.cavernScale, x, y, z) : 0;
  return opens(def, y, a, b, c);
}
