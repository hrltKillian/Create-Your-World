import type { BlockDef, BlockKey, ContentPack, ItemDef, ItemKey, ToolDef } from './schema.ts';

/** Stack size of an item that gives none (docs « Inventaire »: every block and most items). */
export const DEFAULT_STACK = 64;

/**
 * Most items of an item's stack (the rule, in one place): 1 for a tool, a weapon, a wearable or
 * a water container (they keep their own wear or charges, so they never stack), else its
 * `maxStack`, else DEFAULT_STACK.
 */
export function stackLimit(item: ItemDef): number {
  if (item.tool || item.weapon || item.wear || item.container || item.rod) return 1;
  return item.maxStack ?? DEFAULT_STACK;
}

/**
 * Whether a tool (none: the hand) is the kind the block wants (docs « Casser »): only then do its
 * speed and tier count, and it wears normally.
 */
export function fitsTool(block: BlockDef, tool: ToolDef | undefined): boolean {
  return tool !== undefined && block.tool !== undefined && tool.kind === block.tool;
}

/**
 * Whether a tool (none: the hand) harvests a block, i.e. breaking it yields its drops (docs
 * « Casser »): a tool of the block's kind counts its tier, anything else tier 0, and the tier must
 * reach the block's `minTier`.
 */
export function harvests(block: BlockDef, tool: ToolDef | undefined): boolean {
  const tier = tool !== undefined && fitsTool(block, tool) ? tool.tier : 0;
  return tier >= (block.minTier ?? 0);
}

/**
 * The break time rule (docs « Casser »): seconds per hardness point at speed 1, and the slowdown
 * below the block's minimum tier (which also gives no drop).
 */
export const BREAK = { secondsPerHardness: 1.5, weakToolFactor: 3.3 } as const;

/**
 * Seconds a rested player takes to break a block with a tool (none: the hand): hardness × 1.5 /
 * speed (the tool's if it is the right kind, else 1), × 3.3 below the minimum tier. Infinity for
 * an unbreakable block. Shared by the simulation (sim/mining.ts) and the item descriptions.
 */
export function toolBreakSeconds(block: BlockDef, tool: ToolDef | undefined): number {
  if (block.hardness < 0) return Number.POSITIVE_INFINITY;
  const speed = tool !== undefined && fitsTool(block, tool) ? tool.speed : 1;
  const seconds = (block.hardness * BREAK.secondsPerHardness) / speed;
  return harvests(block, tool) ? seconds : seconds * BREAK.weakToolFactor;
}

/** i18n key of a tag's name (the Logbook's « Any Log »): `tag:log` → `tag.log`. */
export function tagNameKey(tag: string): string {
  return `tag.${tag.slice(tag.indexOf(':') + 1)}`;
}

/** Key of the implicit item of a block: `block:dirt` → `item:dirt`. */
export function blockItemKey(block: BlockKey): ItemKey {
  return `item:${block.slice(block.indexOf(':') + 1)}`;
}

/**
 * Placeable blocks (docs/conception.md « Registres »): each has an implicit item that places it,
 * whatever breaking it yields (`drops`). All blocks but the air and unknown-block bindings,
 * liquids and unbreakable blocks.
 */
function placeable(pack: ContentPack) {
  const { air, unknownBlock } = pack.manifest.bindings;
  return pack.blocks.filter(
    (block) =>
      block.key !== air &&
      block.key !== unknownBlock &&
      block.shape !== 'liquid' &&
      block.hardness >= 0,
  );
}

/**
 * Every item of a pack: one implicit item per placeable block (with the traits the block gives it:
 * tags, fuel, hint), then the pack's items.
 */
export function packItems(pack: ContentPack): ItemDef[] {
  const implicit = placeable(pack).map(
    (block): ItemDef => ({
      key: blockItemKey(block.key),
      nameKey: block.nameKey,
      icon: { block: block.key },
      ...block.item,
    }),
  );
  return [...implicit, ...(pack.items ?? [])];
}

/** Lookup tables indexed by numeric item id (the order of `packItems`). */
export interface ItemTables {
  readonly count: number;
  /** Most items of a stack (`stackLimit`). */
  readonly maxStack: Uint16Array;
  /**
   * Uses of a fresh stack: a tool's, a wearable's wear, a rod's, a filled container's charges; 0
   * for items that do not wear.
   */
  readonly durability: Uint16Array;
  /** Block state the item places (its block's, or the one it plants), −1 if it places nothing. */
  readonly places: Int32Array;
}

export function buildItemTables(
  pack: ContentPack,
  items: readonly ItemDef[],
  blockState: (key: BlockKey) => number,
): ItemTables {
  const placed = new Map(placeable(pack).map((b) => [blockItemKey(b.key) as string, b.key]));
  const n = items.length;
  const tables = {
    count: n,
    maxStack: new Uint16Array(n),
    durability: new Uint16Array(n),
    places: new Int32Array(n).fill(-1),
  };
  items.forEach((item, i) => {
    tables.maxStack[i] = stackLimit(item);
    tables.durability[i] =
      item.tool?.durability ??
      item.weapon?.durability ??
      item.wear?.durability ??
      item.rod?.durability ??
      charges(item);
    const block = item.places ?? placed.get(item.key);
    if (block !== undefined) tables.places[i] = blockState(block);
  });
  return tables;
}

/** Drinks a full container holds (0 for an empty one, or an item that is no container). */
function charges(item: ItemDef): number {
  const container = item.container;
  return container && container.contents !== 'empty' ? container.charges : 0;
}
