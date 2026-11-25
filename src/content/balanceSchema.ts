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
  /** Regeneration while fed (hunger and thirst ≥ `regenFedAt`). */
  readonly regenPerSec: number;
  readonly regenFedAt: number;
  /** Seconds without damage before regeneration starts. */
  readonly regenDelaySec: number;
  /** Hunger consumed per point of health regenerated. */
  readonly hungerPerPoint: number;
  /** Below this, the heartbeat and the vignette (HUD). */
  readonly lowAt: number;
}

export interface HungerBalance {
  readonly max: number;
  readonly perMin: number;
  readonly sprintFactor: number;
  /** Stamina spent per point of hunger. */
  readonly staminaPerPoint: number;
  /** Below this, the gauge warns (HUD only: no other effect). */
  readonly lowAt: number;
  /** Health lost per minute at 0. */
  readonly emptyDamagePerMin: number;
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
  readonly fall: FallBalance;
  readonly climate: ClimateBalance;
  readonly water: WaterBalance;
  readonly consume: ConsumeBalance;
  readonly sleep: SleepBalance;
  readonly respawn: RespawnBalance;
  readonly creatures: CreatureBalance;
  readonly combat: CombatBalance;
}
