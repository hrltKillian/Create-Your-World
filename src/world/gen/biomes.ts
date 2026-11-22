import type { BiomeDef, ClimateCondition, ClimateField } from '../../content/schema.ts';
import type { ClimateSample } from './climate.ts';

function fieldValue(sample: ClimateSample, height: number, field: ClimateField): number {
  return field === 'h' ? height : sample[field];
}

function holds(
  cond: ClimateCondition,
  sample: ClimateSample,
  height: number,
  jitter: number,
): boolean {
  // Height thresholds are in blocks: scale the jitter accordingly.
  const value =
    fieldValue(sample, height, cond.field) + (cond.field === 'h' ? jitter * 40 : jitter);
  if (cond.lt !== undefined && !(value < cond.lt)) return false;
  if (cond.gt !== undefined && !(value > cond.gt)) return false;
  return true;
}

/** Index (in `biomes`, sorted by `order`) of the first biome whose rule holds. */
export function pickBiome(
  biomes: readonly BiomeDef[],
  sample: ClimateSample,
  height: number,
  jitter: number,
): number {
  for (let i = 0; i < biomes.length; i++) {
    const biome = biomes[i]!;
    if (biome.all && !biome.all.every((c) => holds(c, sample, height, jitter))) continue;
    if (biome.any && !biome.any.some((c) => holds(c, sample, height, jitter))) continue;
    return i;
  }
  return biomes.length - 1;
}
