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

/** Tool kind names, after the tier name in the "tool too weak" hint (« copper pickaxe »). */
export const toolNames = {
  pick: 'tool.pick',
  axe: 'tool.axe',
} as const satisfies Readonly<Record<ToolKind, PackI18nKey>>;
