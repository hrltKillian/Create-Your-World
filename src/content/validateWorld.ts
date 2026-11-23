import type { ContentPack, FeatureKind } from './schema.ts';

type AddIssue = (path: string, message: string) => void;

/** Largest size of each feature kind (boulders and patches must stay within 7 blocks of their centre). */
const FEATURE_MAX_SIZE: Readonly<Record<FeatureKind, number>> = {
  broadleaf: 16,
  conifer: 16,
  mushroom: 16,
  boulder: 3,
  column: 16,
  patch: 7,
};

/** World generation: worldgen blocks and splines, features, ores and biomes. */
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
    range('worldgen.caves.cavernY', w.caves.cavernY);
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
    const crowned = f.kind === 'broadleaf' || f.kind === 'conifer' || f.kind === 'mushroom';
    if (crowned !== (f.crown !== undefined))
      add(`${path}.crown`, 'trees and mushrooms, and only they, need a crown');
    f.soil.forEach((key, s) => {
      block(`${path}.soil[${s}]`, key);
    });
    range(`${path}.size`, f.size);
    if (f.size[0] < 1 || f.size[1] > FEATURE_MAX_SIZE[f.kind])
      add(`${path}.size`, `must lie within 1–${FEATURE_MAX_SIZE[f.kind]} for a ${f.kind}`);
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
    range(`${path}.yRange`, ore.yRange);
    range(`${path}.veinSize`, ore.veinSize);
    // A vein is a walk inside the 3×3×3 cube around its centre.
    if (ore.veinSize[0] < 1 || ore.veinSize[1] > 27)
      add(`${path}.veinSize`, 'must lie within 1–27');
  });
}
