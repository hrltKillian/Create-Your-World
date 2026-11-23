import { harvests, toolCode } from '../content/items.ts';
import type { Registry } from '../content/registry.ts';
import { type BlockDef, CRACK_STAGES } from '../content/schema.ts';

/** Mining rules (docs/conception.md « Casser »). */
export const MINING = {
  /** Break time per hardness point at speed 1. */
  secondsPerHardness: 1.5,
  /** Slowdown below the block's minimum tier (which also gives no drop). */
  weakToolFactor: 3.3,
  /** Mining speed while exhausted. */
  exhaustedSpeed: 0.6,
  /** Crack stages reported while mining. */
  stages: CRACK_STAGES,
  /** Durability a tool loses per block, with the right kind of tool and with any other. */
  wear: 1,
  wrongToolWear: 2,
  /** Ticks between two hit sounds while mining. */
  hitSoundTicks: 4,
} as const;

/** Engine i18n key of the hint « Tool too weak: {tier} {tool} required » (SimEvent `hint`). */
export const TOOL_TOO_WEAK_HINT = 'hint.toolTooWeak';

/** Whether the held item (−1: empty hand) is the kind of tool the block wants. */
function rightTool(registry: Registry, block: BlockDef, itemId: number): boolean {
  return (
    itemId >= 0 &&
    block.tool !== undefined &&
    registry.itemTables.toolKind[itemId] === toolCode(block.tool)
  );
}

/** Whether breaking the block with the held item yields its drops (tier ≥ the block's minTier). */
export function canHarvest(registry: Registry, state: number, itemId: number): boolean {
  return harvests(registry.blockDef(state), itemId < 0 ? undefined : registry.items[itemId]!.tool);
}

/**
 * Parameters of the « Tool too weak » hint when the held item cannot harvest the block: the pack's
 * i18n keys naming the block's minimum tier and its tool kind. Null when the item is good enough,
 * or when the pack names neither.
 */
export function weakToolParams(
  registry: Registry,
  state: number,
  itemId: number,
): { readonly tier: string; readonly tool: string } | null {
  if (canHarvest(registry, state, itemId)) return null;
  const block = registry.blockDef(state);
  const tier = registry.pack.tiers?.find((def) => def.tier === block.minTier)?.nameKey;
  const tool = block.tool === undefined ? undefined : registry.pack.toolNames?.[block.tool];
  return tier !== undefined && tool !== undefined ? { tier, tool } : null;
}

/**
 * Seconds to break a block: hardness × 1.5 / speed (the tool's speed if it is the right kind,
 * else 1), ×3.3 below the minimum tier, ÷0.6 while exhausted. Infinity for unbreakable blocks.
 */
export function breakSeconds(
  registry: Registry,
  state: number,
  itemId: number,
  exhausted: boolean,
): number {
  const block = registry.blockDef(state);
  if (block.hardness < 0) return Number.POSITIVE_INFINITY;
  const speed = rightTool(registry, block, itemId) ? registry.itemTables.toolSpeed[itemId]! : 1;
  let seconds = (block.hardness * MINING.secondsPerHardness) / speed;
  if (!canHarvest(registry, state, itemId)) seconds *= MINING.weakToolFactor;
  if (exhausted) seconds /= MINING.exhaustedSpeed;
  return seconds;
}

/** Durability the held item loses for breaking a block (0 for items that do not wear). */
export function toolWear(registry: Registry, state: number, itemId: number): number {
  if (itemId < 0 || registry.itemTables.durability[itemId] === 0) return 0;
  const block = registry.blockDef(state);
  if (block.hardness === 0) return 0;
  return rightTool(registry, block, itemId) ? MINING.wear : MINING.wrongToolWear;
}
