import type { ContentPack, FeatureKind, Spline, WorldgenDef } from './schema.ts';

type AddIssue = (path: string, message: string) => void;

/**
 * Largest size of each feature kind (boulders and patches must stay within 7 blocks of their
 * centre); a giant tree's 2×2 trunk may stand 28 high.
 */
const FEATURE_MAX_SIZE: Readonly<Record<FeatureKind, number>> = {
  broadleaf: 28,
  conifer: 28,
  willow: 16,
  mushroom: 16,
  boulder: 3,
  column: 16,
  patch: 7,
};

/** The highest surface the terrain splines can reach (detail included). */
export function highestTerrain(w: WorldgenDef): number {
  const peak = (spline: Spline) => Math.max(...spline.map((p) => p[1]));
  return Math.ceil(
    w.seaLevel + peak(w.continentalSpline) + peak(w.erosionSpline) + w.detailAmplitude,
  );
}

/** World generation: worldgen blocks and splines, features, ores, biomes, spawn and structures. */
export function validateWorld(
  pack: ContentPack,
  blockKeys: ReadonlySet<string>,
  add: AddIssue,
): void {
  const block = (path: string, key: string | undefined) => {
    if (key !== undefined && !blockKeys.has(key)) add(path, `unknown block "${key}"`);
  };
  const range = (path: string, r: readonly [number, number]) => {
    if (!(Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] <= r[1]))
      add(path, 'must be two integers, min ≤ max');
  };
  const w = pack.worldgen;
  if (w) {
    block('worldgen.bedrock', w.bedrock);
    block('worldgen.stone', w.stone);
    block('worldgen.deepStone', w.deepStone);
    block('worldgen.magma', w.magma);
    w.banks.patches.forEach((patch, i) => {
      block(`worldgen.banks.patches[${i}].block`, patch.block);
    });
    w.caves.caverns.bands.forEach((band, i) => {
      range(`worldgen.caves.caverns.bands[${i}].y`, band.y);
    });
    if (w.caves.tunnels.length === 0) add('worldgen.caves.tunnels', 'needs at least one family');
    for (const name of ['continentalSpline', 'erosionSpline'] as const) {
      const spline = w[name];
      if (spline.length < 2) add(`worldgen.${name}`, 'needs at least two points');
      for (let i = 1; i < spline.length; i++) {
        if (!(spline[i]![0] > spline[i - 1]![0]))
          add(`worldgen.${name}[${i}]`, 'inputs must increase');
      }
    }
  }
  const featureKeys = new Set((pack.features ?? []).map((f) => f.key as string));
  (pack.features ?? []).forEach((f, i) => {
    const path = `features[${i}]`;
    block(`${path}.block`, f.block);
    block(`${path}.crown`, f.crown);
    const crowned = f.kind !== 'boulder' && f.kind !== 'column' && f.kind !== 'patch';
    if (crowned !== (f.crown !== undefined))
      add(`${path}.crown`, 'trees and mushrooms, and only they, need a crown');
    f.soil.forEach((key, s) => {
      block(`${path}.soil[${s}]`, key);
    });
    range(`${path}.size`, f.size);
    if (f.size[0] < 1 || f.size[1] > FEATURE_MAX_SIZE[f.kind])
      add(`${path}.size`, `must lie within 1–${FEATURE_MAX_SIZE[f.kind]} for a ${f.kind}`);
    if (f.trunk === 2 && f.kind !== 'broadleaf' && f.kind !== 'conifer')
      add(`${path}.trunk`, 'only broadleaf and conifer trees grow a 2×2 trunk');
  });
  const seen = new Set<string>();
  (pack.biomes ?? []).forEach((b, i) => {
    const path = `biomes[${i}]`;
    if (seen.has(b.key)) add(`${path}.key`, `duplicate biome "${b.key}"`);
    seen.add(b.key);
    if (pack.strings[b.nameKey] === undefined)
      add(`${path}.nameKey`, `no string for "${b.nameKey}"`);
    block(`${path}.surface`, b.surface);
    block(`${path}.filler`, b.filler);
    block(`${path}.seabed`, b.seabed);
    block(`${path}.liquid`, b.liquid);
    block(`${path}.liquidCap`, b.liquidCap);
    (b.features ?? []).forEach((t, k) => {
      if (!featureKeys.has(t.feature))
        add(`${path}.features[${k}].feature`, `unknown feature "${t.feature}"`);
    });
    (b.plants ?? []).forEach((p, k) => {
      block(`${path}.plants[${k}].block`, p.block);
    });
    for (const list of ['features', 'plants'] as const) {
      const total = (b[list] ?? []).reduce((sum, entry) => sum + entry.chance, 0);
      if (total > 1) add(`${path}.${list}`, `chances add up to ${total} (more than 1)`);
    }
  });
  if (pack.biomes && pack.biomes.length > 10)
    add('biomes', 'at most 10 biomes fit the 32 tint slots');
  (pack.ores ?? []).forEach((ore, i) => {
    const path = `ores[${i}]`;
    block(`${path}.block`, ore.block);
    ore.replaces.forEach((key, r) => {
      block(`${path}.replaces[${r}]`, key);
    });
    if (ore.biomes !== '*') {
      ore.biomes.forEach((key, k) => {
        if (!seen.has(key)) add(`${path}.biomes[${k}]`, `unknown biome "${key}"`);
      });
    }
    if (ore.layers.length === 0) add(`${path}.layers`, 'needs at least one layer');
    ore.layers.forEach((layer, l) => {
      const at = `${path}.layers[${l}]`;
      range(`${at}.y`, layer.y);
      range(`${at}.size`, layer.size);
      // A vein is a walk inside the 3×3×3 cube around its centre.
      if (layer.size[0] < 1 || layer.size[1] > 27) add(`${at}.size`, 'must lie within 1–27');
      if (!(layer.chance > 0 && layer.chance <= 1)) add(`${at}.chance`, 'must lie in (0, 1]');
      if (!(Number.isInteger(layer.veins) && layer.veins >= 1))
        add(`${at}.veins`, 'must be a whole number ≥ 1');
    });
    // Under the liquid, the ground lies below the sea level: so must some vein centres.
    if (ore.underLiquid && w && ore.layers.every((layer) => layer.y[0] >= w.seaLevel))
      add(`${path}.underLiquid`, `needs a layer starting below the sea level (${w.seaLevel})`);
  });
  // No layer without ore: common ores (every biome) cover each height from the worldrock up to
  // the highest terrain.
  if (w && pack.ores) {
    const top = highestTerrain(w);
    const covered = new Uint8Array(top + 1);
    for (const ore of pack.ores) {
      if (ore.biomes !== '*' || ore.caveWall) continue;
      for (const layer of ore.layers)
        for (let y = Math.max(1, layer.y[0]); y <= Math.min(top, layer.y[1]); y++) covered[y] = 1;
    }
    const gap = covered.findIndex((c, y) => y >= 1 && c === 0);
    if (gap >= 0) add('ores', `no common ore covers y ${gap} (every height 1–${top} needs one)`);
  }
  const biome = (path: string, key: string) => {
    if (!seen.has(key)) add(path, `unknown biome "${key}"`);
  };
  const spawn = w?.spawn;
  if (spawn) {
    spawn.near.forEach((key, i) => {
      block(`worldgen.spawn.near[${i}]`, key);
    });
    spawn.far.forEach((key, i) => {
      biome(`worldgen.spawn.far[${i}]`, key);
    });
  }
  validateStructures(pack, blockKeys, biome, add);
}

/** Largest template of a structure: width (x), height (layers) and depth (z). */
const STRUCTURE_MAX = { width: 24, height: 10, depth: 24 } as const;

function validateStructures(
  pack: ContentPack,
  blockKeys: ReadonlySet<string>,
  biome: (path: string, key: string) => void,
  add: AddIssue,
): void {
  const chances = new Map<string, number>();
  (pack.structures ?? []).forEach((s, i) => {
    const path = `structures[${i}]`;
    s.biomes.forEach((key, b) => {
      biome(`${path}.biomes[${b}]`, key);
      chances.set(key, (chances.get(key) ?? 0) + s.chance);
    });
    if (!(s.chance >= 0 && s.chance <= 1)) add(`${path}.chance`, 'must lie within 0–1');
    for (const [char, key] of Object.entries(s.legend)) {
      if (char.length !== 1 || char === '.') add(`${path}.legend`, `bad character "${char}"`);
      // The block part of a state key (its properties are checked when generation resolves it).
      const blockKey = key.split('[')[0]!;
      if (!blockKeys.has(blockKey)) add(`${path}.legend.${char}`, `unknown block "${blockKey}"`);
    }
    const depth = s.layers[0]?.length ?? 0;
    const width = s.layers[0]?.[0]?.length ?? 0;
    if (s.layers.length < 1 || s.layers.length > STRUCTURE_MAX.height)
      add(`${path}.layers`, `needs 1–${STRUCTURE_MAX.height} layers`);
    if (width < 1 || width > STRUCTURE_MAX.width || depth < 1 || depth > STRUCTURE_MAX.depth)
      add(`${path}.layers`, `must be 1–${STRUCTURE_MAX.width} × 1–${STRUCTURE_MAX.depth} blocks`);
    s.layers.forEach((rows, y) => {
      if (rows.length !== depth) add(`${path}.layers[${y}]`, `needs ${depth} rows`);
      rows.forEach((row, z) => {
        if (row.length !== width) add(`${path}.layers[${y}][${z}]`, `needs ${width} characters`);
        for (const char of row) {
          if (char !== '.' && s.legend[char] === undefined)
            add(`${path}.layers[${y}][${z}]`, `"${char}" is not in the legend`);
        }
      });
    });
  });
  for (const [key, total] of chances) {
    if (total > 1) add('structures', `chances of ${key} add up to ${total} (more than 1)`);
  }
}
