import { describe, expect, it } from 'vitest';
import { FLAG_SOLID } from '../../../src/content/registry.ts';
import { findStructure } from '../../../src/world/gen/find.ts';
import { columnHash, createGenContext } from '../../../src/world/gen/generateColumn.ts';
import { LatticeCache } from '../../../src/world/gen/sample.ts';
import { REGION, regionOf, type StructureSite, siteIn } from '../../../src/world/gen/structures.ts';
import { structureRegistry as registry } from '../../fixtures/structures.ts';
import { blockIn, generate } from '../../helpers/gen.ts';

const ctx = createGenContext('structures', registry);
const cache = new LatticeCache();

/** Every site of the regions within `reach` regions of the origin. */
function sites(reach: number): StructureSite[] {
  const found: StructureSite[] = [];
  for (let rz = -reach; rz <= reach; rz++) {
    for (let rx = -reach; rx <= reach; rx++) {
      const site = siteIn(ctx, cache, rx, rz);
      if (site) found.push(site);
    }
  }
  return found;
}

/** The columns a site's footprint covers. */
function columnsOf(site: StructureSite): [number, number][] {
  const coords: [number, number][] = [];
  const s = site.structure;
  for (let cz = site.z0 >> 5; cz <= (site.z0 + s.depth - 1) >> 5; cz++)
    for (let cx = site.x0 >> 5; cx <= (site.x0 + s.width - 1) >> 5; cx++) coords.push([cx, cz]);
  return coords;
}

/** The generated block of a world cell among generated columns. */
function blockAt(
  columns: Map<string, ReturnType<typeof generate>>,
  x: number,
  y: number,
  z: number,
) {
  return blockIn(columns.get(`${x >> 5},${z >> 5}`)!, x & 31, y, z & 31);
}

function generateSite(site: StructureSite) {
  return new Map(columnsOf(site).map(([cx, cz]) => [`${cx},${cz}`, generate(ctx, cx, cz)]));
}

const all = sites(12);

describe('structures', () => {
  it('puts at most one structure in a region, well inside it, and both kinds appear', () => {
    const regions = new Set<string>();
    for (const site of all) {
      const rx = regionOf(site.x0);
      const rz = regionOf(site.z0);
      const key = `${rx},${rz}`;
      expect(regions.has(key)).toBe(false);
      regions.add(key);
      // The footprint (grown by the feature reach and 1) stays in the region.
      expect(site.x0 - 8).toBeGreaterThanOrEqual(rx * REGION);
      expect(site.z0 - 8).toBeGreaterThanOrEqual(rz * REGION);
      expect(site.x0 + site.structure.width + 8).toBeLessThanOrEqual((rx + 1) * REGION);
      expect(site.z0 + site.structure.depth + 8).toBeLessThanOrEqual((rz + 1) * REGION);
      expect(site.y).toBeGreaterThan(ctx.def.seaLevel);
    }
    const kinds = new Set(all.map((s) => s.structure.key));
    expect([...kinds].sort()).toEqual(['structure:cairn', 'structure:camp']);
  });

  it('builds the template on its site, clears the air above it and grows no feature there', () => {
    const checked = ['structure:camp', 'structure:cairn'].flatMap((key) =>
      all.filter((s) => s.structure.key === key).slice(0, 3),
    );
    expect(checked.length).toBeGreaterThanOrEqual(4);
    for (const site of checked) {
      const s = site.structure;
      const key = s.key;
      const columns = generateSite(site);
      let blocks = 0;
      for (let layer = 0; layer < s.height + 12; layer++) {
        for (let tz = 0; tz < s.depth; tz++) {
          for (let tx = 0; tx < s.width; tx++) {
            const x = site.x0 + tx;
            const z = site.z0 + tz;
            const actual = blockAt(columns, x, site.y + layer, z);
            const cell =
              layer < s.height ? s.cells[tx + tz * s.width + layer * s.width * s.depth]! : -1;
            if (cell >= 0) {
              expect(actual, `${key} ${tx} ${layer} ${tz}`).toBe(cell);
              blocks++;
            } else if (layer > 0) expect(actual, `${key} ${tx} ${layer} ${tz}`).toBe(registry.air);
          }
        }
      }
      expect(blocks).toBeGreaterThan(10);
      // Solid ground under the whole bottom layer.
      for (let tz = 0; tz < s.depth; tz++) {
        for (let tx = 0; tx < s.width; tx++) {
          const below = blockAt(columns, site.x0 + tx, site.y - 1, site.z0 + tz);
          expect(registry.tables.flags[below]! & FLAG_SOLID).not.toBe(0);
        }
      }
    }
  });

  it('does not depend on the generation order across column borders', () => {
    const site = all.find((s) => columnsOf(s).length > 1)!;
    const coords = columnsOf(site);
    const forward = coords.map(([cx, cz]) => columnHash(ctx, generate(ctx, cx, cz)));
    const fresh = createGenContext('structures', registry);
    const backward = [...coords]
      .reverse()
      .map(([cx, cz]) => columnHash(fresh, generate(fresh, cx, cz)));
    expect(backward.reverse()).toEqual(forward);
  });

  it('finds the nearest structure of a kind', () => {
    const from = { x: 40, z: -30 };
    const camp = findStructure(ctx, 'structure:camp', from, 1500)!;
    expect(camp).not.toBeNull();
    const site = siteIn(ctx, cache, regionOf(camp.x), regionOf(camp.z))!;
    expect(site.structure.key).toBe('structure:camp');
    expect(camp.y).toBe(site.y);
    // No camp of the census is nearer.
    for (const other of all) {
      if (other.structure.key !== 'structure:camp') continue;
      const x = other.x0 + (other.structure.width >> 1);
      const z = other.z0 + (other.structure.depth >> 1);
      expect(Math.sqrt((x - from.x) ** 2 + (z - from.z) ** 2)).toBeGreaterThanOrEqual(
        camp.distance,
      );
    }
    expect(findStructure(ctx, 'structure:camp', from, 0)).toBeNull();
    expect(() => findStructure(ctx, 'structure:nope', from, 100)).toThrow(/Unknown structure/);
  });
});
