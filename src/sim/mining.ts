import { toolCode } from '../content/items.ts';
import type { Registry } from '../content/registry.ts';
import type { BlockDef } from '../content/schema.ts';

/** Mining rules (docs/conception.md « Casser »). */
export const MINING = {
  /** Break time per hardness point at speed 1. */
  secondsPerHardness: 1.5,
  /** Slowdown below the block's minimum tier (which also gives no drop). */
  weakToolFactor: 3.3,
  /** Mining speed while exhausted. */
  exhaustedSpeed: 0.6,
  /** Crack stages reported while mining. */
  stages: 8,
  /** Durability a tool loses per block, with the right kind of tool and with any other. */
  wear: 1,
  wrongToolWear: 2,
  /** Ticks between two hit sounds while mining. */
  hitSoundTicks: 4,
} as const;

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
  const block = registry.blockDef(state);
  const tier = rightTool(registry, block, itemId) ? registry.itemTables.toolTier[itemId]! : 0;
  return tier >= (block.minTier ?? 0);
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
