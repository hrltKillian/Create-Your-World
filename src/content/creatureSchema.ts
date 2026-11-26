/**
 * Creature and box-model data (docs « Créatures et combat », « Rendu »): what a creature is, how it
 * senses, moves, fights and spawns, and the box model the renderer animates. Brains are state
 * machines of the simulation parametrised by these numbers. Re-exported by `schema.ts`.
 */
import type {
  BiomeKey,
  BlockKey,
  CreatureKey,
  ItemKey,
  LootKey,
  ModelKey,
  SfxKey,
  SkinKey,
  TexKey,
} from './schema.ts';

/** Hostile creatures only exist in worlds whose rules allow hostiles. */
export const CREATURE_CATEGORIES = ['passive', 'defensive', 'territorial', 'hostile'] as const;
export type CreatureCategory = (typeof CREATURE_CATEGORIES)[number];

/**
 * The state machine driving a creature: `grazer` wanders and flees, `defender` charges whoever
 * hurts it or its herd, `stalker` hunts from the dark, `swarmer` closes in zigzags, `charger`
 * guards its ground and rams.
 */
export const CREATURE_BRAINS = ['grazer', 'defender', 'stalker', 'swarmer', 'charger'] as const;
export type CreatureBrain = (typeof CREATURE_BRAINS)[number];

/** Hostile spawns need an effective light of at most this (a torch keeps them 9 blocks away). */
export const HOSTILE_MAX_LIGHT = 4;

/** A telegraphed melee attack: wound up for `windup` s, it lands if the target is still in reach. */
export interface CreatureAttack {
  readonly damage: number;
  /**
   * Blocks between the two hitboxes (edge to edge); the player dodges by leaving reach + 0.3, or
   * the line of sight, before the wind-up ends.
   */
  readonly reach: number;
  /** Seconds of wind-up before the hit. */
  readonly windup: number;
  /** Seconds between two attacks. */
  readonly cooldown: number;
  /** Knockback factor (1 = a normal hit). */
  readonly knockback: number;
  /** Toxicity added to the target on a hit. */
  readonly toxicity?: number;
}

export interface CreatureSenses {
  /** Blocks; seeing also needs the player within the field of view and a clear line of sight. */
  readonly sight: number;
  /** Field of view, full angle in degrees (360: sees all around). */
  readonly fovDeg: number;
  /**
   * Factor on the radius of the player's noises (crouching 2, walking 6, mining 10, fighting 12,
   * sprinting 14 blocks): 1 hears a noise within its radius, 0 is deaf.
   */
  readonly hearing: number;
}

/** What sets a brain's behaviour apart; absent traits do nothing. */
export interface CreatureTraits {
  /** Speed factor while the player looks at it (within 30°, line of sight). */
  readonly watchedSpeedMul?: number;
  /** Never steps on a cell whose effective light is this or more (paths avoid it, it flees it). */
  readonly lightAversion?: number;
  /** Burrows away (despawns) at dawn. */
  readonly burrowAtDawn?: boolean;
  /** Share of the damage taken from the front that its armour stops (0.6: −60 %). */
  readonly frontArmor?: number;
  /** Seconds stunned after running into a wall while charging. */
  readonly wallStunSec?: number;
  /** Seconds it flees once hurt or alarmed. */
  readonly fleeSec?: number;
  /** Alerts the members of its herd within this many blocks when hurt. */
  readonly herdAlertRadius?: number;
  /** Attacks a player who comes within this many blocks. */
  readonly territoryRadius?: number;
  /** Share of the knockback it ignores (0–1). */
  readonly knockbackResist?: number;
  /** Damage × (1 + perDay × min(day, maxDays)): stronger every night. */
  readonly escalation?: { readonly perDay: number; readonly maxDays: number };
}

/** Where and when a group of the creature may appear. */
export interface CreatureSpawn {
  readonly biomes: readonly BiomeKey[] | '*';
  readonly when: 'day' | 'night' | 'any';
  /** On the ground under the open sky, or in caves. */
  readonly where: 'surface' | 'cave';
  /** Highest effective light of the spawn cell (hostiles: at most HOSTILE_MAX_LIGHT). */
  readonly maxLight?: number;
  /** Inclusive range of creatures per group. */
  readonly group: readonly [number, number];
  /** Chance against the other entries that fit the same spawn point. */
  readonly weight: number;
}

export const CREATURE_SOUNDS = ['idle', 'alert', 'hurt', 'attack', 'death', 'step'] as const;
export type CreatureSound = (typeof CREATURE_SOUNDS)[number];

export interface CreatureDef {
  readonly key: CreatureKey;
  readonly nameKey: string;
  readonly model: ModelKey;
  /** Width (square footprint, below one block so paths fit a one-block corridor) and height. */
  readonly hitbox: readonly [number, number];
  readonly health: number;
  /** Blocks per second. */
  readonly speed: { readonly walk: number; readonly run: number };
  readonly brain: CreatureBrain;
  readonly category: CreatureCategory;
  /** Every creature but the passive ones fights back. */
  readonly attack?: CreatureAttack;
  readonly senses: CreatureSenses;
  readonly traits?: CreatureTraits;
  readonly spawn: readonly CreatureSpawn[];
  /**
   * How it moves (docs plan v2 « M17 »): accelerations (m/s²) on the ground and in the air, and
   * its turn rate; it moves the way it faces, so a turn costs it speed (a feint, a dodge).
   */
  readonly agility: {
    readonly groundAccel: number;
    readonly airAccel: number;
    readonly turnDegPerSec: number;
  };
  /** Seconds it can run on a full stamina; an empty one makes it walk until half is back. */
  readonly stamina: { readonly runSeconds: number };
  /** What it eats: plants it grazes (blocks), meat it takes from the ground (items, a bait). */
  readonly diet: { readonly plants?: readonly BlockKey[]; readonly meat?: readonly ItemKey[] };
  readonly loot: LootKey;
  readonly sounds: Readonly<Partial<Record<CreatureSound, SfxKey>>>;
}

export type Gait = 'biped' | 'quadruped' | 'hexapod';

/**
 * The legs of each gait and their half-cycle (0 or 1: legs of the same half swing together). Leg
 * parts carry these names and no other part name starts with `leg`. Legs are named by row, F
 * (front), M (middle) or B (back), then side: a quadruped trots in diagonal pairs and a hexapod
 * walks in alternating tripods.
 */
export const GAIT_LEGS: Readonly<Record<Gait, Readonly<Record<string, 0 | 1>>>> = {
  biped: { legL: 0, legR: 1 },
  quadruped: { legFL: 0, legBR: 0, legFR: 1, legBL: 1 },
  hexapod: { legFL: 0, legMR: 0, legBL: 0, legFR: 1, legML: 1, legBR: 1 },
};

/** A box of a creature or avatar model, in 1/16 block, relative to the model origin (feet centre). */
export interface ModelPart {
  readonly name: string;
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
  /** Rotation pivot (same units). */
  readonly pivot: readonly [number, number, number];
  /**
   * Its rest rotation about the pivot (plan v5 « M52 »), degrees about x, then y, then z: a neck
   * leaning forward, horns swept back, legs splayed. The animation turns it from there.
   */
  readonly rotation?: readonly [number, number, number];
  /** Its sides' texture, and every face's without a texture of its own in `faces` (no `skin`). */
  readonly texture?: TexKey;
  /**
   * The faces with a texture of their own (plan v5 « M51 »): the front (−z, where the model looks),
   * the back, the top and the bottom.
   */
  readonly faces?: {
    readonly front?: TexKey;
    readonly back?: TexKey;
    readonly top?: TexKey;
    readonly bottom?: TexKey;
  };
  /**
   * Where its unfolded box starts in the model's skin (texels from the top left; plan v5 « M52 »,
   * the reference game's layout, `skinFaces`).
   */
  readonly uv?: readonly [number, number];
  /** The part follows its parent's rotation; a parent comes before its children. */
  readonly parent?: string;
  /** Drawn at full brightness whatever the light (glowing eyes). */
  readonly emissive?: boolean;
}

/** Texels of a skin atlas a side (plan v5 « M52 »). */
export const SKIN_SIZE = 256;

/**
 * A model's skin atlas (plan v5 « M52 »): `mask` rows of `MASK_INDEX` letters into `palette` from
 * the top ('.' is empty), at most SKIN_SIZE each way, two texels a model unit. Every part of its
 * model unfolds its box from its `uv` the reference game's way (`skinFaces`). Texels of the
 * `glow` palette entries shine whatever the light (eyes, spores).
 */
export interface SkinDef {
  readonly key: SkinKey;
  readonly palette: readonly string[];
  readonly mask: readonly string[];
  readonly glow?: readonly number[];
}

/**
 * Texels a model unit in a skin, and where each face of a box w × h × d texels lies from its `uv`
 * (the reference game's layout): the top and bottom above, then the right side (+x), the front
 * (−z), the left side (−x) and the back in a row. Rectangles: [u, v, width, height].
 */
export const SKIN_TEXELS = 2;
export function skinFaces(
  w: number,
  h: number,
  d: number,
): Readonly<Record<'top' | 'bottom' | 'right' | 'front' | 'left' | 'back', readonly number[]>> {
  return {
    top: [d, 0, w, d],
    bottom: [d + w, 0, w, d],
    right: [0, d, d, h],
    front: [d, d, w, h],
    left: [d + w, d, d, h],
    back: [2 * d + w, d, w, h],
  };
}

/** A box model; it faces −z (north) at yaw 0. */
export interface ModelDef {
  readonly key: ModelKey;
  readonly parts: readonly ModelPart[];
  readonly gait: Gait;
  /** Walk cycle advance in radians per block travelled (short legs step faster). */
  readonly stride: number;
  /**
   * Skins at the world's density (plan v5 « M51 », the reference game's): two texels a unit, each
   * face showing its own corner of its texture (`partSkin`, render/rigs.ts); else every face
   * stretches its whole texture.
   */
  readonly pixels?: boolean;
  /** Its skin atlas (plan v5 « M52 »): every part takes its faces from its `uv` there. */
  readonly skin?: SkinKey;
}
