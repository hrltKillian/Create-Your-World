/**
 * Survival rules of a pack (docs « Survie », « Créatures et combat »): every global number of the
 * survival model, in the units of the docs (per minute, per second, seconds, °C, blocks). Numbers
 * that belong to one piece of content stay with it: a biome's climate and air toxicity
 * (`BiomeDef`), a block's heat and contact (`BlockDef`), what an item restores (`ConsumeDef`),
 * what gear does (`WearDef`), a weapon (`WeaponDef`) and a creature (`CreatureDef`).
 * Re-exported by `schema.ts`; balance tests compute their expectations from these numbers.
 */
import type { WeaponDef } from './itemSchema.ts';

export interface HealthBalance {
  readonly max: number;
  /**
   * The reference game's regeneration (plan v3 « M30 »): with hunger from `regenHungerAt` and
   * thirst from `regenThirstAt`, `regenAmount` every `regenSeconds`; with full hunger and some
   * saturation left, every `fastRegenSeconds`. Each heal costs `regenExhaustion` exhaustion.
   */
  readonly regenHungerAt: number;
  readonly regenThirstAt: number;
  readonly regenAmount: number;
  readonly regenSeconds: number;
  readonly fastRegenSeconds: number;
  readonly regenExhaustion: number;
  /** Below this, the heartbeat and the vignette (HUD). */
  readonly lowAt: number;
}

/**
 * Hunger as the reference game has it (plan v3 « M30 »): the player's efforts add exhaustion; each
 * `exhaustionPerStep` of it takes `step` from the hidden saturation, or from hunger once the
 * saturation is gone. Standing still costs nothing. Foods give hunger and saturation (never more
 * saturation than hunger).
 */
export interface HungerBalance {
  readonly max: number;
  /** The hidden saturation of a new or respawned player. */
  readonly startSaturation: number;
  readonly exhaustionPerStep: number;
  readonly step: number;
  /** Exhaustion of each effort: per block sprinted or swum, a jump, a sprint jump, a blow struck, a blow or fall taken, a block broken. */
  readonly exhaustion: {
    readonly sprintPerBlock: number;
    readonly swimPerBlock: number;
    readonly jump: number;
    readonly sprintJump: number;
    readonly attack: number;
    readonly hurt: number;
    readonly mine: number;
  };
  /** Sprinting needs more hunger than this. */
  readonly sprintFrom: number;
  /** Below this, the gauge warns (HUD only). */
  readonly lowAt: number;
  /** At 0: `starveDamage` health every `starveSeconds`. */
  readonly starveDamage: number;
  readonly starveSeconds: number;
}

export interface ThirstBalance {
  readonly max: number;
  readonly perMin: number;
  readonly sprintFactor: number;
  /** Below this, the gauge warns (HUD only: no other effect). */
  readonly lowAt: number;
  /** Health lost per minute at 0. */
  readonly emptyDamagePerMin: number;
}

/** The temperature gauge, from −limit (frozen) to +limit (scorched); 0 is comfort. */
export interface TemperatureBalance {
  readonly limit: number;
  /** Drift towards the target per minute: away from 0, and back towards 0. */
  readonly awayPerMin: number;
  readonly backPerMin: number;
  /** The gauge warns from ±`mildAt` (HUD only); it hurts from ±`severeAt`. */
  readonly mildAt: number;
  readonly severeAt: number;
  /** Health lost per minute beyond ±`severeAt`. */
  readonly severeDamagePerMin: number;
}

export interface ToxicityBalance {
  readonly max: number;
  /** Decay per minute while no source adds any. */
  readonly decayPerMin: number;
  /** Health lost per minute from `harmAt` (the gauge warns from there), and from `severeAt`. */
  readonly harmAt: number;
  readonly harmPerMin: number;
  readonly severeAt: number;
  readonly severePerMin: number;
}

/** Fire on the player (plan v3 « M29 »): lit by lava, out in water or after a while. */
export interface FireBalance {
  /** A fire lasts between these seconds once out of the lava (drawn each time). */
  readonly minSeconds: number;
  readonly maxSeconds: number;
  /** Health lost per second while burning. */
  readonly damagePerSec: number;
}

/**
 * The weather (plan v3 « M34 »): one kind a spell of `spellSeconds`, drawn from the seed with the
 * `weights` (sim/weather.ts), the first `clearSpells` of a world clear.
 */
export interface WeatherBalance {
  readonly spellSeconds: number;
  readonly clearSpells: number;
  readonly weights: {
    readonly clear: number;
    readonly rain: number;
    readonly storm: number;
    readonly fog: number;
  };
  /** °C a player out in the rain, or in the snow, feels less. */
  readonly rainChillC: number;
  readonly snowChillC: number;
  /** Share of the sky's light left under the clouds (the effective light, the shaders). */
  readonly dim: { readonly rain: number; readonly storm: number; readonly fog: number };
  /** Mean seconds between two lightning strikes near a player in a storm. */
  readonly lightningSeconds: number;
  /** Hostile spawn candidates, × this in a storm. */
  readonly stormSpawns: number;
}

export interface BreathBalance {
  /** Air held with the head under water. */
  readonly seconds: number;
  /** Air regained per second with the head out of the water. */
  readonly refillPerSec: number;
  /** Health lost per second once the air is gone. */
  readonly drowningPerSec: number;
}

export interface FallBalance {
  /** Falls up to this height are free. */
  readonly safeBlocks: number;
  /** Health lost per block fallen beyond `safeBlocks`. */
  readonly damagePerBlock: number;
}

/** Thermal model (docs « Modèle thermique », steps 2–7). */
export interface ClimateBalance {
  /** Altitude cooling (°C per block) above `altitudeFrom`. */
  readonly altitudeFrom: number;
  readonly altitudePerBlock: number;
  /** Caves (no sky light at the head, at least `caveDepth` blocks under the surface). */
  readonly caveC: number;
  readonly caveDepth: number;
  /** How many heat sources count (the strongest ones). */
  readonly heatSources: number;
  /** Cooling of the water around the body. */
  readonly waterC: number;
  /** Comfort range: gear warms up to `comfortMinC` and cools down to `comfortMaxC`. */
  readonly comfortMinC: number;
  readonly comfortMaxC: number;
  /** Temperature target per degree outside the comfort range. */
  readonly targetPerDegree: number;
  /** Seconds between two samples of the surroundings (an edit within `editRadius` samples again). */
  readonly sampleSec: number;
  readonly editRadius: number;
}

/** Eating and drinking (docs « M12 — Contrôles et combustible »). */
export interface ConsumeBalance {
  /** The player's speed is multiplied by this while eating or drinking, without sprint (0–1). */
  readonly moveFactor: number;
}

export interface WaterBalance {
  /** Hold time of a sip from a drinkable liquid (empty hand). */
  readonly sipSec: number;
}

/** Sleeping on a bedroll (docs « Sommeil »). */
export interface SleepBalance {
  /** Allowed from this hour to `toHour` the next morning. */
  readonly fromHour: number;
  readonly toHour: number;
  /** Hour the sleepers wake at. */
  readonly wakeHour: number;
  /** Cost of a night. */
  readonly hunger: number;
  readonly thirst: number;
  /** No hostile creature within this many blocks. */
  readonly hostileRadius: number;
}

/** Coming back after a death (docs « Mort »). */
export interface RespawnBalance {
  readonly health: number;
  readonly hunger: number;
  readonly thirst: number;
}

/** Creature spawning (docs « Apparition »). */
export interface CreatureBalance {
  /** No hostile spawns before this tick of a world: its first 3 real minutes (`?grace=0`). */
  readonly spawnGraceTicks: number;
  /**
   * Hunger and thirst of creatures (docs plan v2 « M17 »), gauges 0–100 (100: sated): they fall by
   * these points a minute; below `seekBelow` a creature looks for food or water within
   * `seekRadius` blocks; a plant grazed, a piece of meat eaten or a drink adds its points; a
   * creature above `seekBelow` in both heals `regenPerMin` health a minute.
   */
  readonly needs: {
    readonly hungerPerMin: number;
    readonly thirstPerMin: number;
    readonly seekBelow: number;
    readonly seekRadius: number;
    readonly plantFood: number;
    readonly meatFood: number;
    readonly drink: number;
    readonly regenPerMin: number;
  };
  /** A creature falling more than `safeBlocks` takes `damagePerBlock` per block beyond. */
  readonly fall: { readonly safeBlocks: number; readonly damagePerBlock: number };
}

/**
 * Experience and skills (plan v3 « M22 »): XP comes from quests and tasks only; level n needs
 * `xpBase + xpStep × (n − 1)` more XP to reach n + 1, and each level gained gives a skill point;
 * a skill takes at most `maxSkill` points, each worth its number here.
 */
export interface ProgressionBalance {
  readonly xpBase: number;
  readonly xpStep: number;
  readonly maxSkill: number;
  /** Tasks a player has at once. */
  readonly tasks: number;
  readonly skills: {
    /** Health. */
    readonly vitality: number;
    /** Stamina. */
    readonly endurance: number;
    /** Inventory slots. */
    readonly carrying: number;
    /** Share of the hunger and thirst rates taken off. */
    readonly metabolism: number;
    /** °C added to each side of the comfort range. */
    readonly resistance: number;
    /** Share added to melee damage and mining speed. */
    readonly strength: number;
  };
}

/** Melee (docs « Combat »). */
export interface CombatBalance {
  /** The empty hand, or a held item without `weapon`: the first row of the weapon table. */
  readonly hand: WeaponDef;
}

export interface BalanceDef {
  readonly health: HealthBalance;
  readonly hunger: HungerBalance;
  readonly thirst: ThirstBalance;
  readonly temperature: TemperatureBalance;
  readonly toxicity: ToxicityBalance;
  readonly breath: BreathBalance;
  readonly fire: FireBalance;
  readonly weather: WeatherBalance;
  readonly fall: FallBalance;
  readonly climate: ClimateBalance;
  readonly water: WaterBalance;
  readonly consume: ConsumeBalance;
  readonly sleep: SleepBalance;
  readonly respawn: RespawnBalance;
  readonly creatures: CreatureBalance;
  readonly combat: CombatBalance;
  readonly progression: ProgressionBalance;
}
