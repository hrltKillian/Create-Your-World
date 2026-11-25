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

export * from './balanceSchema.ts';
export * from './creatureSchema.ts';
export * from './itemSchema.ts';
export * from './questSchema.ts';

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
  ripe: ['0', '1'],
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
  };
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
}

/** Crack stages of a block being mined (mineProgress events, `fracture` textures). */
export const CRACK_STAGES = 8;

/** What a block of a sound material sounds like when broken, hit, placed and walked on. */
export interface BlockSounds {
  readonly break: SfxKey;
  readonly hit: SfxKey;
  readonly place: SfxKey;
  readonly step: SfxKey;
}

/** A pair of sounds for an opening and a closing. */
export interface OpenClose {
  readonly open: SfxKey;
  readonly close: SfxKey;
}

/** The ambient loop of a place by day (day and dawn) and by night (dusk and night). */
export interface DayNightLoops {
  readonly day: SfxKey;
  readonly night: SfxKey;
}

/**
 * Ambient loops (docs « Audio »: no music), crossfaded on the ambience bus: under water first,
 * then in a cave, else the biome's (a biome left out takes `fallback`). They name `loop` recipes.
 */
export interface AmbienceBindings {
  readonly biomes: Readonly<Partial<Record<BiomeKey, DayNightLoops>>>;
  readonly fallback: DayNightLoops;
  readonly cave: SfxKey;
  readonly underwater: SfxKey;
}

/**
 * Sound effects the engine plays for gameplay actions (keyed by the block's sound material), for
 * the local player, the interface, places and the clock, and the ambient loops.
 */
export interface SoundBindings {
  readonly blocks: Readonly<Record<SoundMaterial, BlockSounds>>;
  readonly pickup: SfxKey;
  /** Interface click (bag, slots). */
  readonly click: SfxKey;
  /** One craft of the queue is done (interface bus). */
  readonly craft: SfxKey;
  /** A player's blow landing on a creature, and a creature's blow landing on a player. */
  readonly combat: { readonly hit: SfxKey; readonly hurt: SfxKey };
  /** The local player's own sounds, at the ear. */
  readonly player: {
    readonly jump: SfxKey;
    readonly land: SfxKey;
    /** The body goes into water. */
    readonly splash: SfxKey;
    /** A stroke while swimming. */
    readonly swim: SfxKey;
    readonly eat: SfxKey;
    readonly drink: SfxKey;
    /** Beats while health is under the balance's `health.lowAt`. */
    readonly heartbeat: SfxKey;
    readonly death: SfxKey;
  };
  /** A door or gate toggled (any block with the `open` state). */
  readonly door: OpenClose;
  /** A chest (a `container` block entity) opened and closed. */
  readonly chest: OpenClose;
  /** Crackles of a lit station block near the listener, by station (fire, kilns). */
  readonly lit: Readonly<Partial<Record<StationKey, SfxKey>>>;
  /** Stingers: the sun sets (18:30), a night is survived (06:00). */
  readonly clock: { readonly dusk: SfxKey; readonly dawn: SfxKey };
  readonly ambience: AmbienceBindings;
}

export type SfxSource = 'noise' | 'sine' | 'triangle' | 'square' | 'sawtooth';

/**
 * One layer of a synthesized sound: white noise or a tone, through an optional filter, shaped by
 * a linear attack and an exponential decay.
 */
export interface SfxLayer {
  readonly source: SfxSource;
  /** Tones only: frequency (Hz) at the start and at the end (exponential glide). */
  readonly freq?: readonly [number, number];
  readonly filter?: {
    readonly type: 'lowpass' | 'highpass' | 'bandpass';
    readonly freq: number;
    readonly q?: number;
  };
  /** Peak gain, 0–1. */
  readonly gain: number;
  /** Seconds before the layer starts. */
  readonly delay?: number;
  /** Seconds to the peak (> 0). */
  readonly attack: number;
  /** Seconds held at the peak before the decay (an ambience's steady bed). */
  readonly hold?: number;
  /** Seconds from the peak to silence. */
  readonly decay: number;
}

/**
 * A synthesized sound effect: its layers are mixed together. One-shots are pre-rendered once at
 * startup; a `loop` (an ambience, longer) is rendered on first use and played looped.
 */
export interface SfxDef {
  readonly key: SfxKey;
  readonly layers: readonly SfxLayer[];
  readonly loop?: boolean;
}

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

export type FeatureKey = `feature:${string}`;

/** Climate fields sampled by world generation (all roughly in [−1, 1]) plus the surface height. */
export type ClimateField = 'C' | 'E' | 'M' | 'T' | 'H' | 'X' | 'h';

export interface ClimateCondition {
  readonly field: ClimateField;
  readonly lt?: number;
  readonly gt?: number;
}

/** Piecewise-linear curve: sorted [input, output] points. */
export type Spline = readonly (readonly [number, number])[];

export interface WorldgenDef {
  readonly seaLevel: number;
  readonly deepStoneBelowY: number;
  /** Climate lattice spacing in blocks (bilinear interpolation in between). */
  readonly climateStep: number;
  /** Noise wavelengths in blocks. */
  readonly scales: Readonly<
    Record<
      'continental' | 'erosion' | 'ridges' | 'temperature' | 'humidity' | 'toxicity' | 'detail',
      number
    >
  >;
  /** Temperature band along z: triangle wave (cold to the north at −period/4, hot to the south). */
  readonly latitude: { readonly amplitude: number; readonly period: number };
  readonly continentalSpline: Spline;
  /** Erosion → amplitude of the ridges term. */
  readonly erosionSpline: Spline;
  readonly detailAmplitude: number;
  /**
   * Biome thresholds are shifted by a smooth noise (± `amplitude`, wavelength about `scale`
   * blocks): borders are clean wavy lines, never a dither of single columns.
   */
  readonly biomeBorder: { readonly scale: number; readonly amplitude: number };
  readonly bedrock: BlockKey;
  readonly stone: BlockKey;
  readonly deepStone: BlockKey;
  /** Cave cells below this y fill with `magma` instead of air. */
  readonly magmaBelowY: number;
  readonly magma: BlockKey;
  readonly caves: CaveDef;
  readonly banks: BankDef;
  /** Spawn rules; without them the spawn is the nearest dry column of a spawn biome. */
  readonly spawn?: SpawnDef;
}

/**
 * Spawn point (docs « Point d'apparition »): a dry column of a spawn biome (pack bindings) with
 * water and the `near` surface blocks within `nearRadius` blocks, and the `far` biomes within
 * `farRadius` blocks. The water is the spawn biome's liquid.
 */
export interface SpawnDef {
  readonly near: readonly BlockKey[];
  readonly nearRadius: number;
  readonly far: readonly BiomeKey[];
  readonly farRadius: number;
}

/**
 * Caves (docs « Génération » step 5): 3D noise sampled on a 4×4×4 lattice, trilinear in between.
 * Wavelengths are in blocks (horizontal, vertical).
 */
/**
 * Caves (docs plan v2 « M16 »): tunnel families that cross each other, caverns in depth bands,
 * entrances and ravines on dry land, caves flooded under lake beds and sealed below them.
 */
export interface CaveDef {
  /**
   * Noodle tunnels, one family each: open where n1² + n2² < threshold × the local width factor.
   * Independent families cross into junctions.
   */
  readonly tunnels: readonly {
    readonly scale: readonly [number, number];
    readonly threshold: number;
  }[];
  /** The width factor of the tunnels: a 2D noise of wavelength `scale` mapped to [min, max]. */
  readonly tunnelWidth: { readonly scale: number; readonly min: number; readonly max: number };
  /** Caverns where a 3D noise of `scale` exceeds the band's threshold, in each band's y range. */
  readonly caverns: {
    readonly scale: readonly [number, number];
    readonly bands: readonly {
      readonly y: readonly [number, number];
      readonly threshold: number;
    }[];
  };
  /** Nothing is carved within this many blocks of the surface… */
  readonly surfaceMargin: number;
  /** …except at entrances, where a 2D noise of this wavelength exceeds `threshold`. */
  readonly entrance: { readonly scale: number; readonly threshold: number };
  /**
   * Ravines: cracks from the surface down to `depth` blocks where a 2D noise of `scale` lies
   * within ±`width` of 0, only where a gate noise of `gateScale` exceeds `gate`.
   */
  readonly ravines: {
    readonly scale: number;
    readonly width: number;
    readonly depth: number;
    readonly gateScale: number;
    readonly gate: number;
  };
  /** Under a lake, caves within `floodedDepth` blocks of its bed are generated full of its liquid. */
  readonly floodedDepth: number;
  /** Dry caves keep at least this many blocks of rock between them and any liquid. */
  readonly seal: number;
}

/**
 * Gravel and clay banks along the shores: where the surface lies within [seaLevel − below,
 * seaLevel + above], a 2D noise of wavelength `scale` picks the first patch whose range holds it.
 * A bank replaces the top `depth` blocks.
 */
export interface BankDef {
  readonly below: number;
  readonly above: number;
  readonly scale: number;
  readonly depth: number;
  /** The noise range of each patch: min ≤ n < max (an absent bound is open). */
  readonly patches: readonly {
    readonly block: BlockKey;
    readonly min?: number;
    readonly max?: number;
  }[];
}

export type StructureKey = `structure:${string}`;

/**
 * A structure (docs « Génération » step 8). Each 128×128 region has one candidate point; where
 * the biome there lists structures, one may stand on the ground at that point.
 */
export interface StructureDef {
  readonly key: StructureKey;
  readonly biomes: readonly BiomeKey[];
  /** Chance per region whose candidate lies in one of `biomes` (the chances of a biome add up). */
  readonly chance: number;
  /**
   * Layers from the ground up (at most 24 wide, 10 high and 24 deep), each a list of rows from
   * north to south with one character per block from west to east. `.` is the biome's surface on
   * the bottom layer and air above it; any other character is a block state of `legend`.
   */
  readonly layers: readonly (readonly string[])[];
  /** Character → block state key, e.g. `block:planks` or `block:broadleaf_log[axis=x]`. */
  readonly legend: Readonly<Record<string, string>>;
  /** Character of a container block (a chest) → the loot table that fills it when generated. */
  readonly lootTables?: Readonly<Record<string, LootKey>>;
  /**
   * A story structure (plan v3 « M26 »): once per world, at the nearest flat, dry spot of its
   * biomes whose distance from the spawn lies in `distance` (blocks); `chance` is unused.
   */
  readonly place?: { readonly distance: readonly [number, number] };
}

export type OreKey = `ore:${string}`;

/**
 * Ore veins (docs « Génération » step 6), drawn from a per-section random stream: each vein is a
 * small walk around a centre at least 2 blocks inside the section, and only replaces `replaces`.
 */
/**
 * A layer of an ore (docs plan v2 « M16 »): in each section that reaches y (inclusive), `veins`
 * attempts each start a vein with probability `chance`, of `size` blocks; no vein block ever lies
 * outside y. Nothing else depends on depth: frequency and size come only from the layers.
 */
export interface OreLayer {
  readonly y: readonly [number, number];
  readonly chance: number;
  readonly veins: number;
  /** Inclusive range of blocks per vein. */
  readonly size: readonly [number, number];
}

export interface OreDef {
  readonly key: OreKey;
  readonly block: BlockKey;
  /** Biomes of the vein centre's column ('*': every biome, a common ore). */
  readonly biomes: readonly BiomeKey[] | '*';
  readonly layers: readonly OreLayer[];
  readonly replaces: readonly BlockKey[];
  /** Only blocks touching a cave (an air face neighbour) turn to ore. */
  readonly caveWall?: boolean;
  /** Veins start only under the liquid, where the vein centre's column lies below the sea level. */
  readonly underLiquid?: boolean;
}

export interface BiomeDef {
  readonly key: BiomeKey;
  readonly nameKey: string;
  /** Biomes are tested in ascending order; the first whose conditions all hold wins. */
  readonly order: number;
  readonly all?: readonly ClimateCondition[];
  /** At least one must hold (when present). */
  readonly any?: readonly ClimateCondition[];
  readonly climate: { readonly dayC: number; readonly nightC: number };
  readonly toxicityPerMin?: { readonly day: number; readonly night: number };
  readonly surface: BlockKey;
  readonly filler: BlockKey;
  /** Surface block when under the liquid level. */
  readonly seabed: BlockKey;
  readonly liquid: BlockKey;
  /** Replaces the top liquid layer (frozen lakes). */
  readonly liquidCap?: BlockKey;
  readonly tints: Readonly<Record<'grass' | 'foliage' | 'water', string>>;
  readonly fog: string;
  /**
   * Decoration: features with their chance per 8×8 cell (one candidate per cell, the chances add
   * up), and plants with their chance per surface block.
   */
  readonly features?: readonly { readonly feature: FeatureKey; readonly chance: number }[];
  readonly plants?: readonly { readonly block: BlockKey; readonly chance: number }[];
  /**
   * Sub-zones (plan v3 « M23 »): a slow noise of `scale` blocks multiplies the features' chances
   * by 1 + `contrast` × n (n in −1…1, never below 0): clearings where it is low, dense groves
   * where it is high.
   */
  readonly groves?: { readonly scale: number; readonly contrast: number };
}

/**
 * Decoration shapes: trees (trunk + canopy: round, conical, or a willow's dome with hanging
 * strands), giant mushrooms (stem + cap), boulders (a mound of `block`), columns (a stack of
 * `block`) and patches (`block` on the surface around the centre).
 */
export type FeatureKind =
  | 'broadleaf'
  | 'conifer'
  | 'willow'
  | 'mushroom'
  | 'boulder'
  | 'column'
  | 'patch';

/** A decoration feature. Every shape stays within 7 blocks of its centre horizontally. */
export interface FeatureDef {
  readonly key: FeatureKey;
  readonly kind: FeatureKind;
  /** Trunk, stem, column, boulder or patch block. */
  readonly block: BlockKey;
  /** Canopy or cap (trees and mushrooms). */
  readonly crown?: BlockKey;
  /** Inclusive range: trunk, stem or column height; boulder or patch radius. */
  readonly size: readonly [number, number];
  /** The feature only grows on these surface blocks. */
  readonly soil: readonly BlockKey[];
  /** A giant's 2×2 trunk and its wider crown (trees only; 1 when absent). */
  readonly trunk?: 1 | 2;
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
  readonly biomes?: readonly BiomeDef[];
  readonly features?: readonly FeatureDef[];
  readonly ores?: readonly OreDef[];
  readonly structures?: readonly StructureDef[];
  readonly models?: readonly ModelDef[];
}
