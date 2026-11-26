import { combinations, parseStateKey, stateKey } from './blockStates.ts';
import { Crafting } from './crafting.ts';
import { buildItemTables, type ItemTables, packItems } from './items.ts';
import { buildRawTables, type RawTables } from './rawTables.ts';
import type {
  BlockDef,
  BlockKey,
  BlockSounds,
  ContentPack,
  CreatureDef,
  ItemDef,
  LootTableDef,
  ModelDef,
  SfxKey,
  StateProp,
  TexKey,
} from './schema.ts';
import { STATE_VALUES } from './schema.ts';
import { type ContentIssue, validatePack } from './validate.ts';

export * from './rawTables.ts';

export interface StateInfo {
  readonly id: number;
  readonly block: number;
  /** Text key, e.g. `block:gate[facing4=n,open=1]`; saves store these. */
  readonly key: string;
  readonly props: Readonly<Partial<Record<StateProp, string>>>;
}

export class ContentError extends Error {
  readonly issues: readonly ContentIssue[];

  constructor(issues: readonly ContentIssue[]) {
    super(`Invalid content pack:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`);
    this.name = 'ContentError';
    this.issues = issues;
  }
}

export class Registry {
  readonly pack: ContentPack;
  readonly blocks: readonly BlockDef[];
  readonly states: readonly StateInfo[];
  readonly tables: RawTables;
  readonly textureKeys: readonly TexKey[];
  readonly air: number;
  readonly unknownBlock: number;
  /** Key of the item that stands for saved items the pack no longer has. */
  readonly unknownItem: string;
  /** The block a death leaves the items in (`blockEntity: 'grave'`), −1 if the pack has none. */
  readonly grave: number;
  /** Items by numeric id: the implicit block items, then the pack's items. */
  readonly items: readonly ItemDef[];
  readonly itemTables: ItemTables;
  /** Recipes, processes and stations, with the ingredient and fuel rules. */
  readonly crafting: Crafting;
  private readonly blockIndex: ReadonlyMap<string, number>;
  private readonly stateIndex: ReadonlyMap<string, number>;
  private readonly itemIndex: ReadonlyMap<string, number>;
  private readonly lootIndex: ReadonlyMap<string, LootTableDef>;
  private readonly creatureIndex: ReadonlyMap<string, CreatureDef>;
  private readonly modelIndex: ReadonlyMap<string, ModelDef>;
  private readonly defaults: Uint16Array;
  private readonly withStateMemo = new Map<StateProp, Map<string, Int32Array>>();

  constructor(
    pack: ContentPack,
    states: StateInfo[],
    tables: RawTables,
    blockIndex: Map<string, number>,
    defaults: Uint16Array,
  ) {
    this.pack = pack;
    this.blocks = pack.blocks;
    this.states = states;
    this.tables = tables;
    this.textureKeys = pack.textures.map((t) => t.key);
    this.blockIndex = blockIndex;
    this.stateIndex = new Map(states.map((s) => [s.key, s.id]));
    this.defaults = defaults;
    this.air = this.defaultState(pack.manifest.bindings.air);
    this.unknownBlock = this.defaultState(pack.manifest.bindings.unknownBlock);
    this.unknownItem = pack.manifest.bindings.unknownItem;
    const grave = pack.blocks.find((block) => block.blockEntity === 'grave');
    this.grave = grave ? this.defaultState(grave.key) : -1;
    this.items = packItems(pack);
    this.itemIndex = new Map(this.items.map((item, i) => [item.key, i]));
    this.itemTables = buildItemTables(pack, this.items, (key) => this.defaultState(key));
    this.lootIndex = new Map((pack.loot ?? []).map((table) => [table.key, table]));
    this.creatureIndex = new Map((pack.creatures ?? []).map((def) => [def.key, def]));
    this.modelIndex = new Map((pack.models ?? []).map((model) => [model.key, model]));
    this.crafting = new Crafting(pack, this.items);
  }

  blockDef(stateId: number): BlockDef {
    return this.blocks[this.tables.blockOf[stateId]!]!;
  }

  hasBlock(key: string): boolean {
    return this.blockIndex.has(key);
  }

  defaultState(key: BlockKey): number {
    const index = this.blockIndex.get(key);
    if (index === undefined) throw new Error(`Unknown block "${key}"`);
    return this.defaults[index]!;
  }

  /**
   * State id for a text key, the unknown block when the block is gone (loading saves). Read
   * leniently (`resolveKey`): a key written before a block gained or lost state values still finds
   * its state.
   */
  stateIdOrUnknown(key: string): number {
    return this.resolveKey(key) ?? this.unknownBlock;
  }

  /** State id for a text key, read leniently (`resolveKey`); throws for an unknown block. */
  stateId(key: string): number {
    const id = this.resolveKey(key);
    if (id === undefined) throw new Error(`Unknown block state "${key}"`);
    return id;
  }

  /**
   * The state of a text key: the exact key, else the block's state keeping each written value it
   * still has and the default for the others (`block:torch` before torches hung on walls is
   * `block:torch[attach=floor]`); undefined when the block is unknown.
   */
  private resolveKey(key: string): number | undefined {
    const exact = this.stateIndex.get(key);
    if (exact !== undefined) return exact;
    const parsed = parseStateKey(key);
    const index = this.blockIndex.get(parsed.block as BlockKey);
    if (index === undefined) return undefined;
    const block = this.pack.blocks[index]!;
    const defaults = this.states[this.defaults[index]!]!.props;
    const props: Partial<Record<StateProp, string>> = {};
    for (const name of block.states ?? []) {
      const value = parsed.props[name];
      props[name] =
        value !== undefined && STATE_VALUES[name].includes(value) ? value : defaults[name];
    }
    return this.stateIndex.get(stateKey(block, props));
  }

  prop(stateId: number, prop: StateProp): string | undefined {
    return this.states[stateId]?.props[prop];
  }

  /** Numeric id of an item key, −1 if the pack has no such item. */
  itemId(key: string): number {
    return this.itemIndex.get(key) ?? -1;
  }

  /** Definition of an item key, undefined if the pack has no such item. */
  item(key: string): ItemDef | undefined {
    const id = this.itemId(key);
    return id < 0 ? undefined : this.items[id];
  }

  /** Largest stack of an item (1 for unknown items). */
  maxStack(key: string): number {
    const id = this.itemId(key);
    return id < 0 ? 1 : this.itemTables.maxStack[id]!;
  }

  loot(key: string): LootTableDef | undefined {
    return this.lootIndex.get(key);
  }

  /** A creature by key; undefined for one the pack lacks (a saved unknown creature is ignored). */
  creature(key: string): CreatureDef | undefined {
    return this.creatureIndex.get(key);
  }

  model(key: string): ModelDef | undefined {
    return this.modelIndex.get(key);
  }

  /** Sound of a gameplay action on a block, from its sound material (none without bindings). */
  blockSfx(stateId: number, action: keyof BlockSounds): SfxKey | undefined {
    return this.pack.sounds?.blocks[this.blockDef(stateId).sound][action];
  }

  /**
   * Same block with one state property changed. Memoised per (property, value), so callers that
   * run every frame (the placement ghost) do not build keys again.
   */
  withState(stateId: number, prop: StateProp, value: string): number {
    const info = this.states[stateId];
    if (!info || info.props[prop] === undefined) return stateId;
    let byValue = this.withStateMemo.get(prop);
    if (!byValue) {
      byValue = new Map();
      this.withStateMemo.set(prop, byValue);
    }
    let memo = byValue.get(value);
    if (!memo) {
      memo = new Int32Array(this.states.length).fill(-1);
      byValue.set(value, memo);
    }
    if (memo[stateId]! < 0) {
      const block = this.blocks[info.block]!;
      memo[stateId] = this.stateId(stateKey(block, { ...info.props, [prop]: value }));
    }
    return memo[stateId]!;
  }
}

/** Validates the pack and flattens every (block, state values) combination into a state id. */
export function buildRegistry(pack: ContentPack): Registry {
  const issues = validatePack(pack);
  if (issues.length > 0) throw new ContentError(issues);

  const states: StateInfo[] = [];
  const blockIndex = new Map<string, number>();
  const defaults = new Uint16Array(pack.blocks.length);
  pack.blocks.forEach((block, b) => {
    blockIndex.set(block.key, b);
    defaults[b] = states.length;
    for (const props of combinations(block.states ?? [])) {
      states.push({ id: states.length, block: b, key: stateKey(block, props), props });
    }
  });

  const tables = buildRawTables(pack, states);
  return new Registry(pack, states, tables, blockIndex, defaults);
}
