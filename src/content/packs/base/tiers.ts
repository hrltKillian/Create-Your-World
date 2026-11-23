import type { TierDef, ToolKind } from '../../schema.ts';
import type { PackI18nKey } from './i18n.en.ts';

type PackTier = TierDef & { readonly nameKey: PackI18nKey };

/** Tool tiers (docs/conception.md « Outils et paliers »): names for the "tool too weak" hint. */
export const tiers = [
  { tier: 0, nameKey: 'tier.hand' },
  { tier: 1, nameKey: 'tier.flint' },
  { tier: 2, nameKey: 'tier.copper' },
  { tier: 3, nameKey: 'tier.bronze' },
  { tier: 4, nameKey: 'tier.iron' },
] as const satisfies readonly PackTier[];

/** Tier, mining speed (the hand is 1) and durability of the tools of each material. */
export const TOOL_TIERS = {
  flint: { tier: 1, speed: 2, durability: 60 },
  copper: { tier: 2, speed: 3.5, durability: 160 },
  bronze: { tier: 3, speed: 5, durability: 320 },
  iron: { tier: 4, speed: 7, durability: 640 },
} as const;

export type ToolMaterial = keyof typeof TOOL_TIERS;

/** Tool kind names, after the tier name in the "tool too weak" hint (« copper pickaxe »). */
export const toolNames = {
  pick: 'tool.pick',
  axe: 'tool.axe',
} as const satisfies Readonly<Record<ToolKind, PackI18nKey>>;
