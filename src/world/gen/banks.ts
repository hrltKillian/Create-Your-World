import type { BankDef, BlockKey } from '../../content/schema.ts';
import { type Noise2, noise2 } from '../../core/noise.ts';
import type { GenContext, ResolvedBiome } from './generateColumn.ts';

/** Shore banks of the pack, with block states resolved. */
export interface ResolvedBanks {
  readonly def: BankDef;
  readonly noise: Noise2;
  readonly patches: readonly {
    readonly state: number;
    readonly min: number;
    readonly max: number;
  }[];
}

export function resolveBanks(
  seed: string,
  def: BankDef,
  state: (key: BlockKey) => number,
): ResolvedBanks {
  return {
    def,
    noise: noise2(seed, 'banks'),
    patches: def.patches.map((p) => ({
      state: state(p.block),
      min: p.min ?? Number.NEGATIVE_INFINITY,
      max: p.max ?? Number.POSITIVE_INFINITY,
    })),
  };
}

/**
 * Bank block (gravel, clay…) replacing the top of a shore column whose surface is at `h`, or −1.
 * Analytic: decoration and the spawn search ask it without generating anything.
 */
export function bankAt(ctx: GenContext, x: number, z: number, h: number): number {
  const banks = ctx.banks;
  const sea = ctx.def.seaLevel;
  if (h < sea - banks.def.below || h > sea + banks.def.above) return -1;
  const n = banks.noise(x / banks.def.scale, z / banks.def.scale);
  for (const patch of banks.patches) if (n >= patch.min && n < patch.max) return patch.state;
  return -1;
}

/**
 * Top terrain block of a column whose surface is at `h` (before caves and decoration): its bank,
 * else the biome's seabed under the liquid level or its surface. Analytic, like `bankAt`.
 */
export function topBlockAt(
  ctx: GenContext,
  x: number,
  z: number,
  h: number,
  biome: ResolvedBiome,
): number {
  const bank = bankAt(ctx, x, z, h);
  if (bank >= 0) return bank;
  return h < ctx.def.seaLevel ? biome.seabed : biome.surface;
}
