/**
 * Content data schema. Everything game-specific (blocks, items, textures, names…) is plain data
 * described by these types, so the game can be re-themed without touching engine code.
 */

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

export type StateProp = 'axis' | 'facing4' | 'open' | 'lit' | 'half' | 'ripe';

/** Possible values of each state property; the first one is the default. */
export const STATE_VALUES: Readonly<Record<StateProp, readonly string[]>> = {
  axis: ['y', 'x', 'z'],
  facing4: ['n', 'e', 's', 'w'],
  open: ['0', '1'],
  lit: ['0', '1'],
  half: ['lower', 'upper'],
  ripe: ['0', '1'],
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
  readonly contact?: { readonly toxicityPerMin?: number; readonly damagePerSec?: number };
  readonly liquid?: LiquidDef;
  readonly hardness: number;
  readonly tool?: ToolKind;
  readonly minTier?: Tier;
  readonly drops: LootKey | 'self' | 'none';
  readonly states?: readonly StateProp[];
  readonly whenState?: Partial<Record<'lit' | 'open' | 'ripe', BlockOverride>>;
  readonly heat?: { readonly celsius: number; readonly radius: number };
  readonly blockEntity?: 'container' | 'station' | 'grave' | 'bed';
  readonly station?: StationKey;
  readonly placement?: {
    readonly support?: 'below' | 'face';
    readonly orient?: 'axis' | 'facing';
    readonly tall?: 2;
  };
  readonly sound: SoundMaterial;
}

export type TexturePattern =
  | 'speckle'
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
  | 'furnaceFront'
  | 'checker';

/** How a texture uses its alpha channel. */
export type TextureAlpha = 'opaque' | 'coverage' | 'emissiveMask' | 'tintMask';

export interface TextureDef {
  readonly key: TexKey;
  readonly pattern: TexturePattern;
  /** sRGB colours ('#rrggbb'), darkest first. Some patterns use extra colours (ore flecks, flame…). */
  readonly palette: readonly string[];
  readonly seed: number;
  readonly alpha?: TextureAlpha;
}

export interface PackBindings {
  readonly air: BlockKey;
  readonly unknownBlock: BlockKey;
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
}
