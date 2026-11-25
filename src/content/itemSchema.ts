/**
 * Item, loot and crafting data (docs « Gameplay »): what players carry, find, make and
 * burn. Re-exported by `schema.ts`.
 */
import type {
  BlockKey,
  ItemKey,
  LootKey,
  ProcessKey,
  RecipeKey,
  StationKey,
  TagKey,
  TexKey,
  Tier,
  ToolKind,
} from './schema.ts';

export interface ToolDef {
  readonly kind: ToolKind;
  readonly tier: Tier;
  /** Mining speed when the block wants this kind of tool (the hand is 1). */
  readonly speed: number;
  /** Uses before the tool breaks. */
  readonly durability: number;
}

/** Burning an item in a station's fuel slot. */
export interface FuelDef {
  readonly seconds: number;
  /** Charcoal grade: the only fuel a `fuel: 'charcoal'` process accepts. */
  readonly charcoal?: boolean;
}

/** Melee use of an item (M10). */
export interface WeaponDef {
  readonly damage: number;
  /** Seconds between two attacks. */
  readonly cooldown: number;
  /** Blocks. */
  readonly reach: number;
  /** Knockback factor (1 = a normal hit). */
  readonly knockback: number;
  /** Uses before a weapon that is no tool breaks, one a blow landed (a tool's are its `tool`'s). */
  readonly durability?: number;
}

export type WearSlot = 'head' | 'face' | 'body' | 'legs' | 'feet';

/** Equipment slots, from the head down (the Bag's silhouette). */
export const WEAR_SLOTS: readonly WearSlot[] = ['head', 'face', 'body', 'legs', 'feet'];

/** An item worn in an equipment slot (sim/equipment.ts, the thermal model, the air's toxicity). */
export interface WearDef {
  readonly slot: WearSlot;
  readonly armor?: number;
  /** °C added below the comfort range. */
  readonly warmth?: number;
  /** °C removed above the comfort range. */
  readonly cooling?: number;
  /** Factor applied to the toxicity of the air (0.15: ×0.15). */
  readonly airFilter?: number;
  /** Cancels foul water at the feet. */
  readonly waterproof?: boolean;
  /**
   * A scanner (head only): looking at a creature in sight within `range` blocks for `seconds`
   * studies it (the bestiary), and the target panel shows its state (docs plan v2 « M17 »).
   */
  readonly scanner?: { readonly seconds: number; readonly range: number };
  /** Hits absorbed, or seconds of use for an `airFilter` piece (its stack's `durability`). */
  readonly durability: number;
}

/** Eating or drinking an item: secondary held `seconds` (sim/consume.ts). */
export interface ConsumeDef {
  /** Hold time. */
  readonly seconds: number;
  readonly hunger?: number;
  readonly thirst?: number;
  readonly health?: number;
  readonly toxicity?: number;
  /** What the item turns into once consumed. */
  readonly returns?: ItemKey;
  /** Inventory slots it adds once used (a backpack frame), up to the largest inventory. */
  readonly bagSlots?: number;
}

export type ContainerContents = 'empty' | 'raw' | 'boiled' | 'foul';

/**
 * A water container (flask, waterskin): each charge is one drink. A filled container's stack keeps
 * the charges left as its `durability` (uses left, like a tool's), full when absent.
 */
export interface LiquidContainerDef {
  readonly charges: number;
  readonly contents: ContainerContents;
  /** The same container once its last charge is drunk. */
  readonly emptyAs: ItemKey;
}

/** Traits a block's implicit item can carry (the rest comes from the block). */
export interface ImplicitItemTraits {
  readonly tags?: readonly TagKey[];
  readonly fuel?: FuelDef;
  readonly hintKey?: string;
}

export interface ItemDef {
  readonly key: ItemKey;
  readonly nameKey: string;
  /** Icon texture, or the block whose faces draw it. */
  readonly icon: TexKey | { readonly block: BlockKey };
  /**
   * Most items of a stack when it is not the default 64 (a tool, a weapon, a wearable and a water
   * container stack to 1 whatever it says: content/items.ts `stackLimit`).
   */
  readonly maxStack?: number;
  /** Groups an ingredient can name instead of an item (`tag:log`). */
  readonly tags?: readonly TagKey[];
  readonly tool?: ToolDef;
  readonly weapon?: WeaponDef;
  readonly wear?: WearDef;
  readonly consume?: ConsumeDef;
  readonly container?: LiquidContainerDef;
  readonly fuel?: FuelDef;
  /** Where the item is found (i18n key): the Logbook's hint for an ingredient not yet seen. */
  readonly hintKey?: string;
}

/** Display name of a tool tier (hint « Tool too weak: copper pickaxe required »). */
export interface TierDef {
  readonly tier: Tier;
  readonly nameKey: string;
}

export interface LootEntry {
  readonly item: ItemKey;
  /** Inclusive range. */
  readonly count: readonly [number, number];
  readonly weight: number;
}

export interface LootTableDef {
  readonly key: LootKey;
  /**
   * Inclusive range of draws. Each draw picks an entry not drawn yet (rolls never exceed the
   * entries), so a creature with two entries and two rolls always drops both.
   */
  readonly rolls: readonly [number, number];
  readonly entries: readonly LootEntry[];
  /** Weight of drawing nothing on a roll (tall grass gives fibre 60 % of the time). */
  readonly empty?: number;
}

/** Logbook tabs. */
export type RecipeCategory = 'materials' | 'tools' | 'building' | 'equipment' | 'survival';

/** Logbook tabs in display order. */
export const RECIPE_CATEGORIES: readonly RecipeCategory[] = [
  'materials',
  'tools',
  'building',
  'equipment',
  'survival',
];

/** An input: an item, or any item carrying a tag. */
export interface Ingredient {
  readonly item: ItemKey | TagKey;
  readonly count: number;
}

export interface ItemCount {
  readonly item: ItemKey;
  readonly count: number;
}

/** A Logbook recipe (docs « Craft : le Logbook »), made by hand or at a station nearby. */
export interface RecipeDef {
  readonly key: RecipeKey;
  readonly category: RecipeCategory;
  /** Needs a block of this station within reach; absent: by hand. */
  readonly station?: StationKey;
  readonly seconds: number;
  readonly inputs: readonly Ingredient[];
  readonly output: ItemCount;
  /** Known from the start; the others are revealed once one of their ingredients has been seen. */
  readonly known?: 'start';
  /** Crafted only from this player level on (plan v3 « M22 »). */
  readonly level?: number;
}

/** What a process burns: any fuel, charcoal-grade fuel only, or nothing. */
export type ProcessFuel = 'any' | 'charcoal' | 'none';

/** A transformation inside a station block (docs « Stations de transformation »). */
export interface ProcessDef {
  readonly key: ProcessKey;
  readonly station: StationKey;
  readonly seconds: number;
  readonly fuel: ProcessFuel;
  readonly inputs: readonly Ingredient[];
  readonly output: ItemCount;
}

/**
 * A station: a crafting place (workbench: no slots, no fire) or a processing block entity with
 * input, fuel and output slots and a fire that drives its `lit` state.
 */
export interface StationDef {
  readonly key: StationKey;
  /** Name of its screen and of the Logbook's « N more at the Workbench ». */
  readonly nameKey: string;
  /** Inputs and fuel of a processing station (none for a workbench). */
  readonly inputSlots: number;
  readonly fuelSlot: boolean;
  /** Where its processes, or a workbench's crafts, wait to be taken. */
  readonly outputSlots: number;
  /** A processing station: its fire burns fuel only while one of its processes runs. */
  readonly burns?: boolean;
  /**
   * Its fire may also be kept burning without a process, for warmth and light (the campfire's
   * « Keep burning » toggle on its screen; any fuel).
   */
  readonly keepLit?: boolean;
}
