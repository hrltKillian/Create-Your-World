import type { LootKey } from '../../content/schema.ts';
import type { Column } from '../Column.ts';
import { SECTION_BITS, SECTION_SIZE } from '../coords.ts';
import { type FoundStructure, spiral } from './find.ts';
import type { GenContext } from './generateColumn.ts';
import { biomeOf, LatticeCache } from './sample.ts';
import { findSpawn } from './spawn.ts';
import {
  lootIn,
  nearSite,
  REGION,
  regionOf,
  type StructureSite,
  siteAt,
  siteIn,
} from './structures.ts';

/*
 * Every structure site of a world (plan v3 « M26 »): the story structures, each once at the
 * nearest flat, dry spot of its biomes in its distance range around the spawn (`storySites`,
 * computed once per world and pure), and the regions' own (structures.ts `siteIn`), which give way
 * to a story site near them. Generation, the containers' loot and the searches read them here.
 */

/** Story spots are looked for every STEP blocks; two story sites keep SPACING blocks apart. */
const STEP = 8;
const SPACING = 32;
/** Features keep this far from a footprint (decor.ts REACH). */
const REACH = 7;

const memo = new WeakMap<GenContext, readonly StructureSite[]>();

/**
 * The story sites of a world, in the pack's order. The spawn search generates columns, and those
 * know no story site yet: the sites wait for the spawn (none while it is searched).
 */
export function storySites(ctx: GenContext): readonly StructureSite[] {
  const known = memo.get(ctx);
  if (known) return known;
  const stories = ctx.structures.filter((s) => s.place !== null);
  if (ctx.worldType !== 'default' || stories.length === 0) {
    memo.set(ctx, []);
    return [];
  }
  memo.set(ctx, []);
  const spawn = findSpawn(ctx);
  const cache = new LatticeCache();
  const sites: StructureSite[] = [];
  const sx = Math.floor(spawn.x);
  const sz = Math.floor(spawn.z);
  for (const structure of stories) {
    const { min, max } = structure.place!;
    spiral(Math.ceil(max / STEP), (dx, dz) => {
      const d = Math.sqrt(dx * dx + dz * dz) * STEP;
      if (d < min || d > max) return false;
      const x = sx + dx * STEP;
      const z = sz + dz * STEP;
      if (structure.inBiome[biomeOf(ctx, cache, x, z)] !== 1) return false;
      if (sites.some((s) => nearSite(s, x, z, SPACING))) return false;
      const site = siteAt(ctx, cache, structure, x, z);
      if (site) sites.push(site);
      return site !== null;
    });
  }
  memo.set(ctx, sites);
  return sites;
}

/** Whether a site's footprint, grown by `margin`, meets the block rectangle [x0, x1) × [z0, z1). */
function meets(
  site: StructureSite,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  margin: number,
) {
  const s = site.structure;
  return (
    site.x0 - margin < x1 &&
    site.x0 + s.width + margin > x0 &&
    site.z0 - margin < z1 &&
    site.z0 + s.depth + margin > z0
  );
}

/**
 * The sites a column deals with: the story sites within twice the features' reach of it, and its
 * region's own site unless a story site lies within that reach of it.
 */
export function columnSites(ctx: GenContext, cache: LatticeCache, column: Column): StructureSite[] {
  const x0 = column.cx * SECTION_SIZE;
  const z0 = column.cz * SECTION_SIZE;
  const story = storySites(ctx);
  // A feature candidate within REACH of a footprint gives way to it, and that candidate's own
  // reach spans REACH more: every column it touches must know the site.
  const sites = story.filter((s) =>
    meets(s, x0, z0, x0 + SECTION_SIZE, z0 + SECTION_SIZE, 2 * REACH),
  );
  const shift = 7 - SECTION_BITS;
  const own = siteIn(ctx, cache, column.cx >> shift, column.cz >> shift);
  if (
    own &&
    !story.some((s) =>
      meets(own, s.x0, s.z0, s.x0 + s.structure.width, s.z0 + s.structure.depth, 2 * REACH),
    )
  )
    sites.push(own);
  return sites;
}

/**
 * Loot table of the structure container generated at a block, if any (analytic: whether the
 * block is still there is the caller's business).
 */
export function structureLootAt(
  ctx: GenContext,
  x: number,
  y: number,
  z: number,
): LootKey | undefined {
  // Flat worlds have no structures.
  if (ctx.worldType !== 'default') return undefined;
  for (const site of storySites(ctx)) {
    const loot = lootIn(site, x, y, z);
    if (loot) return loot;
  }
  const own = siteIn(ctx, new LatticeCache(), regionOf(x), regionOf(z));
  return own ? lootIn(own, x, y, z) : undefined;
}

/** The nearest structure of a kind (its key) within `maxRadius` blocks of `from`, or null. */
export function findStructure(
  ctx: GenContext,
  structureKey: string,
  from: { readonly x: number; readonly z: number },
  maxRadius: number,
): FoundStructure | null {
  if (!ctx.structures.some((s) => s.key === structureKey))
    throw new Error(`Unknown structure "${structureKey}"`);
  const cache = new LatticeCache();
  const reach = Math.ceil(maxRadius / REGION) + 1;
  const rx0 = regionOf(Math.floor(from.x));
  const rz0 = regionOf(Math.floor(from.z));
  const candidates: StructureSite[] = [...storySites(ctx)];
  for (let rz = rz0 - reach; rz <= rz0 + reach; rz++)
    for (let rx = rx0 - reach; rx <= rx0 + reach; rx++) {
      const site = siteIn(ctx, cache, rx, rz);
      if (site) candidates.push(site);
    }
  let best = null as FoundStructure | null;
  for (const site of candidates) {
    if (site.structure.key !== structureKey) continue;
    const x = site.x0 + (site.structure.width >> 1);
    const z = site.z0 + (site.structure.depth >> 1);
    const distance = Math.sqrt((x - from.x) * (x - from.x) + (z - from.z) * (z - from.z));
    if (distance <= maxRadius && (!best || distance < best.distance))
      best = { x, y: site.y, z, distance };
  }
  return best;
}
