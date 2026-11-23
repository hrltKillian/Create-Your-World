import type { BlockKey, ContentPack, ItemDef, ItemKey, ToolKind } from './schema.ts';

/** Stack size of the implicit item of a block. */
export const BLOCK_STACK = 50;

/** Tool kinds as small integers (`ItemTables.toolKind`): 0 is no tool. */
export const TOOL_NONE = 0;
const TOOL_CODES: Readonly<Record<ToolKind, number>> = { pick: 1, axe: 2 };

export function toolCode(kind: ToolKind | undefined): number {
  return kind === undefined ? TOOL_NONE : TOOL_CODES[kind];
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

/** Every item of a pack: one implicit item per placeable block, then the pack's items. */
export function packItems(pack: ContentPack): ItemDef[] {
  const implicit = placeable(pack).map(
    (block): ItemDef => ({
      key: blockItemKey(block.key),
      nameKey: block.nameKey,
      icon: { block: block.key },
      maxStack: BLOCK_STACK,
    }),
  );
  return [...implicit, ...(pack.items ?? [])];
}

/** Lookup tables indexed by numeric item id (the order of `packItems`). */
export interface ItemTables {
  readonly count: number;
  readonly maxStack: Uint16Array;
  /** TOOL_NONE or the code of the tool kind (`toolCode`). */
  readonly toolKind: Uint8Array;
  readonly toolTier: Uint8Array;
  /** Mining speed of a matching tool (1 for items that are not tools). */
  readonly toolSpeed: Float64Array;
  /** Uses of a fresh tool; 0 for items that do not wear. */
  readonly durability: Uint16Array;
  /** Block state the item places, −1 if it places nothing. */
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
    toolKind: new Uint8Array(n),
    toolTier: new Uint8Array(n),
    toolSpeed: new Float64Array(n),
    durability: new Uint16Array(n),
    places: new Int32Array(n).fill(-1),
  };
  items.forEach((item, i) => {
    tables.maxStack[i] = item.maxStack;
    tables.toolKind[i] = toolCode(item.tool?.kind);
    tables.toolTier[i] = item.tool?.tier ?? 0;
    tables.toolSpeed[i] = item.tool?.speed ?? 1;
    tables.durability[i] = item.tool?.durability ?? 0;
    const block = placed.get(item.key);
    if (block !== undefined) tables.places[i] = blockState(block);
  });
  return tables;
}
