import type { CaveDef } from '../../content/schema.ts';
import { type Noise2, type Noise3, noise2, noise3 } from '../../core/noise.ts';
import type { Column } from '../Column.ts';
import { columnIndex, localIndex, SECTION_SIZE, WORLD_HEIGHT } from '../coords.ts';
import { bilerp } from './climate.ts';
import type { GenContext } from './generateColumn.ts';
import { heightAt, type LatticeCache } from './sample.ts';

/*
 * Caves (docs « Génération » step 5, plan v2 « M16 »). 3D noises sampled on a world-anchored
 * 4×4×4 lattice and interpolated trilinearly: tunnel families (n1² + n2² small, their width set by
 * a 2D noise) that cross each other, and caverns in depth bands where a third noise is high. On dry
 * land far from any liquid, entrances let caves reach the surface and ravines crack it open.
 * Under a lake, the caves within `floodedDepth` blocks of its bed are generated full of its liquid;
 * every dry cave keeps `seal` blocks of rock between it and any liquid, so generation never leaves
 * a liquid beside or above air (nothing flows until a player opens the way).
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
/** Margin of the padded heights around a column: the farthest a seal looks (`CaveDef.seal` ≤ it). */
export const MARGIN = 3;
/** Row length of the padded heights generation reads (`MARGIN` blocks on each side). */
export const PADDED = SECTION_SIZE + 2 * MARGIN;
/** No liquid within the seal's reach. */
const DRY = 1 << 20;

/** Index in the padded heights of a column's cell (lx, lz) (0–31, or up to MARGIN outside). */
export function heightIndex(lx: number, lz: number): number {
  return (lz + MARGIN) * PADDED + lx + MARGIN;
}

export interface CaveNoise {
  readonly def: CaveDef;
  /** Two noises per tunnel family. */
  readonly tunnels: readonly Noise3[];
  readonly width: Noise2;
  readonly cavern: Noise3;
  readonly entrance: Noise2;
  readonly ravine: Noise2;
  readonly ravineGate: Noise2;
}

export function createCaveNoise(seed: string, def: CaveDef): CaveNoise {
  return {
    def,
    tunnels: def.tunnels.flatMap((_, i) => [
      noise3(seed, `caves.tunnel${i}a`),
      noise3(seed, `caves.tunnel${i}b`),
    ]),
    width: noise2(seed, 'caves.width'),
    cavern: noise3(seed, 'caves.cavern'),
    entrance: noise2(seed, 'caves.entrance'),
    ravine: noise2(seed, 'caves.ravine'),
    ravineGate: noise2(seed, 'caves.ravineGate'),
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

/** The tunnels' width factor at a block column. */
function widthAt(ctx: GenContext, x: number, z: number): number {
  const w = ctx.caves.def.tunnelWidth;
  return w.min + ((w.max - w.min) * (ctx.caves.width(x / w.scale, z / w.scale) + 1)) / 2;
}

/** Whether the cavern noise opens a cell at height y (0 outside every band). */
function cavernOpens(def: CaveDef, y: number, cavern: number): boolean {
  for (const band of def.caverns.bands) {
    const edge = Math.min(y - band.y[0], band.y[1] - y);
    if (edge < 0) continue;
    // The threshold rises over the last blocks of the band, so caverns close into rounded floors
    // and ceilings instead of flat cuts.
    const closing = edge < CAVERN_TAPER ? (CAVERN_TAPER - edge) * CAVERN_TAPER_STEP : 0;
    if (cavern > band.threshold + closing) return true;
  }
  return false;
}

/** Whether a height lies in any cavern band. */
function inCavernBand(def: CaveDef, y: number): boolean {
  for (const band of def.caverns.bands) if (y >= band.y[0] && y <= band.y[1]) return true;
  return false;
}

/**
 * How a block column may be carved, from its surface `h`, the lowest surface of it and its 4
 * neighbours (`hMin`) and `bed`: the lowest floor of a flooded band within the seal's reach
 * (a lake's bed − `floodedDepth`; DRY when no lake is that near).
 * - `flood`: a lake column (h < sea level) floods the caves of (flood, h]; WORLD_HEIGHT on land;
 * - dry caves reach `dry`: at least `seal` blocks of rock under `bed`, `surfaceMargin` under
 *   `hMin`, or up to the surface at an entrance of dry land;
 * - `ravine` blocks under the surface crack open (dry land far from liquids only).
 */
interface ColumnCaves {
  dry: number;
  flood: number;
  ravine: number;
}

function columnCaves(
  ctx: GenContext,
  x: number,
  z: number,
  h: number,
  hMin: number,
  bed: number,
  out: ColumnCaves,
): ColumnCaves {
  const def = ctx.caves.def;
  out.flood = h < ctx.def.seaLevel ? h - def.floodedDepth : WORLD_HEIGHT;
  out.ravine = 0;
  if (bed === DRY && hMin >= ctx.def.seaLevel) {
    const e = ctx.caves.entrance(x / def.entrance.scale, z / def.entrance.scale);
    out.dry = e > def.entrance.threshold ? h : hMin - def.surfaceMargin;
    out.ravine = ravineDepth(ctx, x, z);
  } else {
    out.dry = Math.min(bed - def.seal - 1, hMin - def.surfaceMargin);
  }
  return out;
}

/** Depth of the ravine crack at a block column (0: none). */
function ravineDepth(ctx: GenContext, x: number, z: number): number {
  const r = ctx.caves.def.ravines;
  if (ctx.caves.ravineGate(x / r.gateScale, z / r.gateScale) <= r.gate) return 0;
  const n = Math.abs(ctx.caves.ravine(x / r.scale, z / r.scale));
  if (n >= r.width) return 0;
  return Math.floor(r.depth * (1 - n / r.width));
}

/** The flooded floor a lake column of surface h sets for its neighbours (DRY on land). */
function floodFloor(ctx: GenContext, h: number): number {
  return h < ctx.def.seaLevel ? h - ctx.caves.def.floodedDepth : DRY;
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

// Scratch buffers of `carveCaves` (generation is synchronous: one set per worker), grown to the
// pack's number of tunnel noises on first use.
const tunnelLattices: Float64Array[] = [];
const tunnelLevels: Float64Array[] = [];
const cavern = new Float64Array(SPAN * SPAN * LEVELS);
const cavernLevels = new Float64Array(LEVELS);
const drys = new Int16Array(SECTION_SIZE * SECTION_SIZE);
const floods = new Int16Array(SECTION_SIZE * SECTION_SIZE);
const ravines = new Int16Array(SECTION_SIZE * SECTION_SIZE);
const caves: ColumnCaves = { dry: 0, flood: 0, ravine: 0 };

/** Highest and lowest y of the cavern bands. */
function cavernRange(def: CaveDef): [number, number] {
  let lo = WORLD_HEIGHT;
  let hi = -1;
  for (const band of def.caverns.bands) {
    lo = Math.min(lo, band.y[0]);
    hi = Math.max(hi, band.y[1]);
  }
  return [lo, hi];
}

/**
 * Carves the caves of a column (its biomes already set: a flooded cave takes its biome's liquid).
 * `heights` holds the surface heights of the column and of a MARGIN-block ring around it (rows of
 * PADDED, `heightIndex`).
 */
export function carveCaves(ctx: GenContext, column: Column, heights: Int16Array): void {
  const def = ctx.caves.def;
  const noises = ctx.caves.tunnels;
  while (tunnelLattices.length < noises.length) {
    tunnelLattices.push(new Float64Array(SPAN * SPAN * LEVELS));
    tunnelLevels.push(new Float64Array(LEVELS));
  }
  const x0 = column.cx * SECTION_SIZE;
  const z0 = column.cz * SECTION_SIZE;
  let maxRoof = 0;
  for (let lz = 0; lz < SECTION_SIZE; lz++) {
    for (let lx = 0; lx < SECTION_SIZE; lx++) {
      const i = heightIndex(lx, lz);
      const h = heights[i]!;
      const hMin = Math.min(
        h,
        heights[i - 1]!,
        heights[i + 1]!,
        heights[i - PADDED]!,
        heights[i + PADDED]!,
      );
      let bed = DRY;
      for (let dz = -def.seal; dz <= def.seal; dz++)
        for (let dx = -def.seal; dx <= def.seal; dx++)
          bed = Math.min(bed, floodFloor(ctx, heights[i + dz * PADDED + dx]!));
      columnCaves(ctx, x0 + lx, z0 + lz, h, hMin, bed, caves);
      const ci = columnIndex(lx, lz);
      drys[ci] = caves.dry;
      floods[ci] = caves.flood;
      ravines[ci] = caves.ravine;
      const roof = caves.flood < WORLD_HEIGHT ? h : caves.dry;
      if (roof > maxRoof) maxRoof = roof;
    }
  }
  if (maxRoof < 1) {
    carveRavines(ctx, column, heights);
    return;
  }

  // Lattice values, only up to the highest level a cell can read (and caverns only in their bands).
  const top = (maxRoof >> STEP_BITS) + 1;
  const [bandLo, bandHi] = cavernRange(def);
  const cavernLo = bandLo >> STEP_BITS;
  const cavernHi = Math.min(top, (bandHi >> STEP_BITS) + 1);
  const ix0 = x0 >> STEP_BITS;
  const iz0 = z0 >> STEP_BITS;
  for (let n = 0; n < noises.length; n++)
    fillLattice(tunnelLattices[n]!, noises[n]!, def.tunnels[n >> 1]!.scale, ix0, iz0, 0, top);
  fillLattice(cavern, ctx.caves.cavern, def.caverns.scale, ix0, iz0, cavernLo, cavernHi);

  for (let lz = 0; lz < SECTION_SIZE; lz++) {
    for (let lx = 0; lx < SECTION_SIZE; lx++) {
      const ci = columnIndex(lx, lz);
      const dry = drys[ci]!;
      const flood = floods[ci]!;
      const h = heights[heightIndex(lx, lz)]!;
      const roof = flood < WORLD_HEIGHT ? h : dry;
      if (roof < 1) continue;
      // Interpolate each lattice level across x and z once, then along y per cell.
      const tx = (lx & 3) / STEP;
      const tz = (lz & 3) / STEP;
      const corner = ((lz >> STEP_BITS) * SPAN + (lx >> STEP_BITS)) * LEVELS;
      const levels = (roof >> STEP_BITS) + 1;
      for (let n = 0; n < noises.length; n++) {
        const lattice = tunnelLattices[n]!;
        const out = tunnelLevels[n]!;
        for (let iy = 0; iy <= levels; iy++) out[iy] = across(lattice, corner, iy, tx, tz);
      }
      const hi = Math.min(levels, cavernHi);
      for (let iy = cavernLo; iy <= hi; iy++) cavernLevels[iy] = across(cavern, corner, iy, tx, tz);
      const width = widthAt(ctx, x0 + lx, z0 + lz);
      const liquid = ctx.biomes[column.biomes[ci]!]!.liquid;
      for (let y = 1; y <= roof; y++) {
        // A lake's caves are flooded near its bed, sealed by rock above the dry ones.
        if (y > dry && y <= flood) continue;
        const iy = y >> STEP_BITS;
        const ty = (y & 3) / STEP;
        if (!opensAt(def, y, iy, ty, width)) continue;
        const state = y > flood ? liquid : carvedState(ctx, y);
        column.sections[y >> 5]!.setBlock(localIndex(lx, y & 31, lz), state);
      }
    }
  }
  carveRavines(ctx, column, heights);
}

/** Whether the interpolated levels (`tunnelLevels`, `cavernLevels`) open a cell at height y. */
function opensAt(def: CaveDef, y: number, iy: number, ty: number, width: number): boolean {
  for (let f = 0; f < def.tunnels.length; f++) {
    const la = tunnelLevels[f * 2]!;
    const lb = tunnelLevels[f * 2 + 1]!;
    const a = lerp(la[iy]!, la[iy + 1]!, ty);
    const b = lerp(lb[iy]!, lb[iy + 1]!, ty);
    if (a * a + b * b < def.tunnels[f]!.threshold * width) return true;
  }
  if (!inCavernBand(def, y)) return false;
  return cavernOpens(def, y, lerp(cavernLevels[iy]!, cavernLevels[iy + 1]!, ty));
}

/** Cracks the ravines of a column open from its surface down. */
function carveRavines(ctx: GenContext, column: Column, heights: Int16Array): void {
  for (let lz = 0; lz < SECTION_SIZE; lz++) {
    for (let lx = 0; lx < SECTION_SIZE; lx++) {
      const depth = ravines[columnIndex(lx, lz)]!;
      if (depth === 0) continue;
      const h = heights[heightIndex(lx, lz)]!;
      for (let y = Math.max(1, h - depth + 1); y <= h; y++)
        column.sections[y >> 5]!.setBlock(localIndex(lx, y & 31, lz), carvedState(ctx, y));
    }
  }
}

/** A dry cave cell's state once carved: magma deep down, air elsewhere. */
function carvedState(ctx: GenContext, y: number): number {
  return y < ctx.def.magmaBelowY ? ctx.magma : ctx.registry.air;
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

const pointCaves: ColumnCaves = { dry: 0, flood: 0, ravine: 0 };

/**
 * Whether generation carves the cell (x, y, z) into a dry cave (air, or magma deep down): flooded
 * caves are liquid, not caves. Analytic, no generation.
 */
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
  const def = ctx.caves.def;
  const hMin = Math.min(
    h,
    heightAt(ctx, cache, x - 1, z),
    heightAt(ctx, cache, x + 1, z),
    heightAt(ctx, cache, x, z - 1),
    heightAt(ctx, cache, x, z + 1),
  );
  // So near the surface, only an entrance or a ravine of dry land opens a cell: most columns are
  // answered here, before the seal's 7×7 heights (`columnCaves` gives the same answer).
  if (y > hMin - def.surfaceMargin) {
    if (hMin < ctx.def.seaLevel) return false;
    const entrance = ctx.caves.entrance(x / def.entrance.scale, z / def.entrance.scale);
    const ravine = ravineDepth(ctx, x, z);
    if (entrance <= def.entrance.threshold && !(ravine > 0 && y > h - ravine)) return false;
  }
  let bed = DRY;
  for (let dz = -def.seal; dz <= def.seal; dz++)
    for (let dx = -def.seal; dx <= def.seal; dx++)
      bed = Math.min(bed, floodFloor(ctx, heightAt(ctx, cache, x + dx, z + dz)));
  const c = columnCaves(ctx, x, z, h, hMin, bed, pointCaves);
  if (c.ravine > 0 && y > h - c.ravine) return true;
  if (y > c.dry) return false;
  if (tunnelsAt(ctx, x, y, z) !== 0) return true;
  if (!inCavernBand(def, y)) return false;
  return cavernOpens(def, y, noiseAt(ctx.caves.cavern, def.caverns.scale, x, y, z));
}

/**
 * The tunnel families whose noise opens the cell (bit f for family f), whatever the roofs: two
 * bits where tunnels cross. Analytic, as `caveAt`.
 */
export function tunnelsAt(ctx: GenContext, x: number, y: number, z: number): number {
  const def = ctx.caves.def;
  const width = widthAt(ctx, x, z);
  let open = 0;
  for (let f = 0; f < def.tunnels.length; f++) {
    const scale = def.tunnels[f]!.scale;
    const a = noiseAt(ctx.caves.tunnels[f * 2]!, scale, x, y, z);
    const b = noiseAt(ctx.caves.tunnels[f * 2 + 1]!, scale, x, y, z);
    if (a * a + b * b < def.tunnels[f]!.threshold * width) open |= 1 << f;
  }
  return open;
}
