/**
 * Content data schema. Everything game-specific (blocks, items, textures, names…) is plain data
 * described by these types, so the game can be re-themed without touching engine code.
 */

import type { BalanceDef } from './balanceSchema.ts';
import type { CreatureDef, ModelDef } from './creatureSchema.ts';
import type {
  ImplicitItemTraits,
  ItemDef,
  LootTableDef,
  ProcessDef,
  RecipeDef,
  StationDef,
  TierDef,
} from './itemSchema.ts';
import type { QuestDef, TaskDef } from './questSchema.ts';
import type { SkyDef } from './skySchema.ts';
import type { SfxDef, SoundBindings } from './soundSchema.ts';
import type { BiomeDef, FeatureDef, OreDef, StructureDef, WorldgenDef } from './worldgenSchema.ts';

export * from './balanceSchema.ts';
export * from './creatureSchema.ts';
export * from './itemSchema.ts';
export * from './questSchema.ts';
export * from './skySchema.ts';
export * from './soundSchema.ts';
export * from './worldgenSchema.ts';

export type BlockKey = `block:${string}`;
export type ItemKey = `item:${string}`;
export type TagKey = `tag:${string}`;
export type TexKey = `tex:${string}`;
export type SfxKey = `sfx:${string}`;
export type LootKey = `loot:${string}`;
export type StationKey = `station:${string}`;
export type BiomeKey = `biome:${string}`;
export type CreatureKey = `creature:${string}`;
export type ModelKey = `model:${string}`;
export type RecipeKey = `recipe:${string}`;
export type ProcessKey = `process:${string}`;

export type Tier = 0 | 1 | 2 | 3 | 4;

/** Axis-aligned box in 1/16 of a block: x0, y0, z0, x1, y1, z1 (0–16). */
export type Box16 = readonly [number, number, number, number, number, number];

export type ToolKind = 'pick' | 'axe';

export type SoundMaterial =
  | 'stone'
  | 'soil'
  | 'sand'
  | 'gravel'
  | 'wood'
  | 'leaves'
  | 'glass'
  | 'water'
  | 'metal'
  | 'cloth';

export type StateProp =
  | 'axis'
  | 'facing4'
  | 'open'
  | 'lit'
  | 'half'
  | 'ripe'
  | 'moist'
  | 'attach'
  | 'placed'
  | 'level'
  | 'falling';

/** Possible values of each state property; the first one is the default. */
export const STATE_VALUES: Readonly<Record<StateProp, readonly string[]>> = {
  axis: ['y', 'x', 'z'],
  facing4: ['n', 'e', 's', 'w'],
  open: ['0', '1'],
  lit: ['0', '1'],
  half: ['lower', 'upper'],
  /** A crop bears its harvest (plan v3 « M33 »): generated ones ripe, planted ones bare. */
  ripe: ['1', '0'],
  /** Farmland watered (plan v3 « M33 »: sim/farmland.ts). */
  moist: ['0', '1'],
  /** Where a block hangs (torches): on the floor, or against the wall on that side of its cell. */
  attach: ['floor', 'n', 'e', 's', 'w'],
  /** Set by a player's placement: decaying blocks (leaves) placed by hand never decay. */
  placed: ['0', '1'],
  /** A liquid's level: 0 is a source, 1–7 flowing ever thinner (sim/liquids.ts). */
  level: ['0', '1', '2', '3', '4', '5', '6', '7'],
  /** A flowing liquid falling from the same liquid above (its level is then 1). */
  falling: ['0', '1'],
};

export type TextureSlot = 'all' | 'top' | 'bottom' | 'side' | 'front';
export type BlockTextures = Partial<Record<TextureSlot, TexKey>>;

export type BlockShape =
  | 'cube'
  | 'cross'
  | 'liquid'
  | 'none'
  | { readonly boxes: readonly Box16[] };
export type RenderPass = 'opaque' | 'cutout' | 'translucent' | 'invisible';
export type Collision = 'full' | 'none' | 'liquid' | { readonly boxes: readonly Box16[] };

export interface BlockLight {
  /** Emitted block light, 0–15. */
  readonly emit?: number;
  /** Extra light lost when passing through (leaves 1, water 2…). */
  readonly filter?: number;
}

export interface BlockOverride {
  readonly emit?: number;
  readonly heat?: { readonly celsius: number; readonly radius: number };
  readonly collision?: Collision;
  readonly opaque?: boolean;
  readonly light?: BlockLight;
  readonly textures?: BlockTextures;
  readonly shape?: BlockShape;
}

export interface LiquidDef {
  readonly drinkable: boolean;
  readonly thirstPerSip: number;
  readonly toxicityPerSip: number;
  /** Empty container item → filled item. */
  readonly fills: Readonly<Partial<Record<ItemKey, ItemKey>>>;
  /**
   * How the liquid flows (sim/liquids.ts, the reference game's rules): a block's update every
   * `seconds`, flowing down first, else spreading towards the nearest drop within `holeSearch`
   * blocks; `infinite`: two sources beside a cell over solid ground make it a source. Without it the
   * liquid never moves. The block needs the `level` and `falling` states.
   */
  readonly flow?: {
    readonly seconds: number;
    readonly holeSearch: number;
    readonly infinite: boolean;
    /** Levels lost per block spread (water 1; lava 2: it reaches half as far). Default 1. */
    readonly step?: number;
  };
  /**
   * What the liquid turns into where another liquid touches it (plan v3 « M29 »: lava meeting
   * water): its source block, its flowing block.
   */
  readonly hardens?: { readonly source: BlockKey; readonly flow: BlockKey };
  /** What a rod fishes out of it (plan v3 « M33 »; a biome's `fish` replaces it there). */
  readonly fish?: LootKey;
}

/**
 * Farmland (plan v3 « M33 », the reference game's): `moist` while a liquid that does not burn lies
 * within `irrigation` blocks of it (on its level or one above); dry with nothing planted on it, or
 * under a solid block, it turns back into `dries`. A crop on dry farmland ripens twice as slowly;
 * a player landing on it from a jump tramples it. The block has the `moist` state.
 */
export interface SoilDef {
  readonly irrigation: number;
  readonly dries: BlockKey;
}

/**
 * A crop (plan v3 « M33 »): while `ripe` it bears `harvest`, picked by secondary (the plant stays,
 * bare) or rolled with its drops when broken; a bare one ripens `seconds` later (a pseudo-random
 * time in the range) where the sky or a lamp gives it `light` (0–15), else it waits. The block has
 * the `ripe` state (generated ones ripe, planted ones bare: sim/crops.ts).
 */
export interface CropDef {
  readonly harvest: LootKey;
  readonly seconds: readonly [number, number];
  readonly light: number;
}

export interface BlockDef {
  readonly key: BlockKey;
  readonly nameKey: string;
  readonly shape: BlockShape;
  readonly pass: RenderPass;
  /** Faces against a neighbour of the same group are hidden (water/water, leaves/leaves…). */
  readonly cullGroup?: string;
  readonly textures: BlockTextures;
  readonly tint?: 'grass' | 'foliage' | 'water';
  readonly collision: Collision;
  /** Opaque blocks hide neighbouring faces, cast ambient occlusion and stop light. */
  readonly opaque: boolean;
  readonly replaceable?: boolean;
  readonly light?: BlockLight;
  readonly friction?: number;
  /** A ladder (plan v3 « M27 »): a body inside it climbs instead of falling. */
  readonly climbable?: boolean;
  /**
   * What touching the block does (at the feet or under them): toxicity, damage, and `ignites`: the
   * player catches fire (plan v3 « M29 », lava).
   */
  readonly contact?: {
    readonly toxicityPerMin?: number;
    readonly damagePerSec?: number;
    readonly ignites?: boolean;
  };
  readonly liquid?: LiquidDef;
  readonly hardness: number;
  readonly tool?: ToolKind;
  readonly minTier?: Tier;
  readonly drops: LootKey | 'self' | 'none';
  readonly states?: readonly StateProp[];
  readonly whenState?: Partial<Record<'lit' | 'open' | 'ripe' | 'moist', BlockOverride>>;
  readonly crop?: CropDef;
  /** What a hoe turns it into, with air above (grass and dirt: farmland; plan v3 « M33 »). */
  readonly tills?: BlockKey;
  /** Farmland: crops are planted on it only (sim/farmland.ts). */
  readonly soil?: SoilDef;
  readonly heat?: { readonly celsius: number; readonly radius: number };
  /**
   * What secondary does on the block, with the state the simulation keeps for it: a chest's
   * contents, a station's slots and fire, a workbench's craft queue and outputs (`workbench`: its
   * station's recipes, sim/workbench.ts), an Abandoned Pack's items (`grave`, left by a death:
   * sim/death.ts), or nothing for a bedroll (`bed`: sleeping, sim/sleep.ts).
   */
  readonly blockEntity?: 'container' | 'station' | 'workbench' | 'grave' | 'bed';
  /**
   * The station this block is: a processing station runs its processes, a workbench makes its
   * recipes; quests may ask for one nearby.
   */
  readonly station?: StationKey;
  /**
   * Boxes of the block hung on a wall (`attach` ≠ floor), drawn against the north side of the cell
   * and turned to the wall's side.
   */
  readonly wallShape?: { readonly boxes: readonly Box16[] };
  /**
   * Decays like leaves (sim/leafDecay.ts): unless placed by a player, the block falls apart (as if
   * broken, with its drops) `seconds` after no `anchors` block lies within `radius` blocks of it
   * (Manhattan distance).
   */
  readonly decay?: {
    readonly anchors: readonly BlockKey[];
    readonly radius: number;
    readonly seconds: readonly [number, number];
  };
  readonly placement?: {
    /**
     * What holds the block: the solid block below (`below`), or for an `attach` block the floor or
     * the wall it hangs on (`attach`). Without it, it pops off (sim/support.ts).
     */
    readonly support?: 'below' | 'attach';
    readonly orient?: 'axis' | 'facing';
    /** Two cells high (doors): needs the `half` state; placed, toggled and broken whole. */
    readonly tall?: 2;
  };
  readonly sound: SoundMaterial;
  /** Traits of the block's implicit item (logs are fuel and carry `tag:log`…). */
  readonly item?: ImplicitItemTraits;
}

export type TexturePattern =
  | 'speckle'
  /** Rock: mottling, hairline cracks, pits (plan v4 « M36 »). */
  | 'stone'
  /** Rounded pebbles with grit between them. */
  | 'gravel'
  /** Fine grain over wind ripples (sand, snow). */
  | 'sand'
  /** Soil clumps with a few pebbles. */
  | 'soil'
  /** Grass seen from above. */
  | 'turf'
  /** Fur and plumes: fine strands in soft clumps (creatures, plan v4 « M41 »). */
  | 'fur'
  | 'strata'
  | 'planks'
  | 'bark'
  | 'rings'
  | 'leaves'
  | 'turfSide'
  | 'ore'
  | 'bricks'
  | 'cutStone'
  | 'ripple'
  | 'glass'
  | 'cross'
  | 'torch'
  | 'lattice'
  /** Two rails and rungs over holes (a ladder). */
  | 'ladder'
  | 'furnaceFront'
  /** Molten blobs (SPECIAL, last colours) under a dark crust (magma). */
  | 'sludge'
  /** Glowing shards (SPECIAL, last two colours) in a rock (dawn crystal). */
  | 'crystal'
  | 'checker'
  /** Pixel art drawn from `mask` (item icons). */
  | 'icon'
  /** Crack overlay of a block being mined, at one of 8 stages (`stage`). */
  | 'fracture';

/**
 * How a texture uses its alpha channel. On opaque blocks, only `tintMask` and `tintFull` faces
 * receive the block tint (so a grass block's dirt underside stays brown).
 */
export type TextureAlpha = 'opaque' | 'coverage' | 'emissiveMask' | 'tintMask' | 'tintFull';

export interface TextureDef {
  readonly key: TexKey;
  readonly pattern: TexturePattern;
  /** sRGB colours ('#rrggbb'), darkest first. Some patterns use extra colours (ore flecks, flame…). */
  readonly palette: readonly string[];
  readonly seed: number;
  readonly alpha?: TextureAlpha;
  /**
   * `icon` pattern only: rows from the top, one character per pixel: `.` is transparent and a digit
   * is a palette index. Scaled to the pack's texture size.
   */
  readonly mask?: readonly string[];
  /** `fracture` pattern only: crack stage 0…CRACK_STAGES−1 (each contains the earlier cracks). */
  readonly stage?: number;
  /**
   * Strength of the relief the normal map shows (plan v4 « M36 »), 0 (flat) to 4; by default the
   * pattern's own.
   */
  readonly relief?: number;
  /** Roughness of the surface, 0 (polished) to 1 (matte); 0.85 by default. */
  readonly roughness?: number;
  /** Roughness of the mask texels (ore flecks, crystals, embers); `roughness` by default. */
  readonly maskRoughness?: number;
  /**
   * `leaves` and `bark` only: the last `accents` palette colours are round spots over the pattern
   * (berries, fruit, pods), each spot one whole colour.
   */
  readonly accents?: number;
}

/** Crack stages of a block being mined (mineProgress events, `fracture` textures). */
export const CRACK_STAGES = 8;

/** Layout of the `arena` test world around its spawn, described with the pack's own blocks. */
export interface ArenaDef {
  /** Closed 5×4×5 cabin: walls, roof, a door (a tall block, both halves) and a window. */
  readonly cabin: {
    readonly wall: BlockKey;
    readonly roof: BlockKey;
    readonly door: BlockKey;
    readonly window: BlockKey;
  };
  readonly pond: { readonly liquid: BlockKey; readonly shore: BlockKey };
  readonly gravel: BlockKey;
  readonly tree: { readonly log: BlockKey; readonly leaves: BlockKey };
  /** A wall of 2-block pillars, one per block (ores and stones of every tier). */
  readonly oreWall: readonly BlockKey[];
  /** Stations and furniture in a row just north of the spawn (the M8 browser checks use them). */
  readonly workshop: readonly BlockKey[];
}

export interface PackBindings {
  readonly air: BlockKey;
  readonly unknownBlock: BlockKey;
  /** What a saved item of a key the pack no longer has becomes (it keeps the saved key). */
  readonly unknownItem: ItemKey;
  /** Biomes where a new player may appear. */
  readonly spawnBiomes?: readonly BiomeKey[];
  /** Model drawn for players in third person. */
  readonly avatarModel?: ModelKey;
}

export interface PackManifest {
  readonly id: string;
  readonly version: number;
  readonly locale: string;
  /** Texture resolution in pixels (square). */
  readonly textureSize: number;
  readonly bindings: PackBindings;
}

/** Layout of the developer test scene (`?scene=testchunk`), described with the pack's own blocks. */
export interface DevSceneDef {
  /** Ground layers from bottom to top; the top layer is the surface. */
  readonly ground: readonly BlockKey[];
  readonly pond?: { readonly liquid: BlockKey; readonly shore?: BlockKey };
  readonly tree?: { readonly log: BlockKey; readonly leaves: BlockKey };
  readonly plant?: BlockKey;
  /** Platform under the showcase of every block state. */
  readonly showcaseFloor?: BlockKey;
}

/** A content pack, as consumed by the registry. */
export interface ContentPack {
  readonly manifest: PackManifest;
  readonly blocks: readonly BlockDef[];
  readonly textures: readonly TextureDef[];
  /** Display strings of this pack (English), keyed by i18n key. */
  readonly strings: Readonly<Record<string, string>>;
  /** Tint colours by tint channel ('grass', 'foliage', 'water'). */
  readonly tints: Readonly<Record<'grass' | 'foliage' | 'water', string>>;
  readonly devScene?: DevSceneDef;
  readonly arena?: ArenaDef;
  /** Items besides the implicit ones (every placeable block has an item of the same name). */
  readonly items?: readonly ItemDef[];
  readonly tiers?: readonly TierDef[];
  /** Name (i18n key) of each tool kind, for the same hint. */
  readonly toolNames?: Readonly<Partial<Record<ToolKind, string>>>;
  readonly loot?: readonly LootTableDef[];
  readonly recipes?: readonly RecipeDef[];
  readonly processes?: readonly ProcessDef[];
  readonly stations?: readonly StationDef[];
  readonly creatures?: readonly CreatureDef[];
  /** Survival rules (balance.ts). */
  readonly balance: BalanceDef;
  /** The quest graph: each quest after those it requires (plan v3 « M21 »). */
  readonly quests?: readonly QuestDef[];
  /** General tasks drawn for each player (plan v3 « M22 »). */
  readonly tasks?: readonly TaskDef[];
  readonly sounds?: SoundBindings;
  /** Synthesis recipes of every sound effect the bindings name. */
  readonly sfx?: readonly SfxDef[];
  readonly worldgen?: WorldgenDef;
  /** The sky: palette, sun, moons, giant, nebulae, auroras (plan v4 « M39 »). */
  readonly sky?: SkyDef;
  readonly biomes?: readonly BiomeDef[];
  readonly features?: readonly FeatureDef[];
  readonly ores?: readonly OreDef[];
  readonly structures?: readonly StructureDef[];
  readonly models?: readonly ModelDef[];
}
