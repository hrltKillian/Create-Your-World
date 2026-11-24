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
  /** Regeneration while fed (hunger and thirst ≥ `regenFedAt`), with no status in the way. */
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
  readonly coldFactor: number;
  /** Stamina spent per point of hunger. */
  readonly staminaPerPoint: number;
  /** Below this, stamina is capped at `lowStaminaMax`. */
  readonly lowAt: number;
  readonly lowStaminaMax: number;
  /** Health lost per minute at 0. */
  readonly emptyDamagePerMin: number;
}

export interface ThirstBalance {
  readonly max: number;
  readonly perMin: number;
  readonly hotFactor: number;
  readonly sprintFactor: number;
  /** Below this, stamina regenerates `lowStaminaRegen` times as fast. */
  readonly lowAt: number;
  readonly lowStaminaRegen: number;
  /** Health lost per minute at 0. */
  readonly emptyDamagePerMin: number;
}

/** The temperature gauge, from −limit (frozen) to +limit (scorched); 0 is comfort. */
export interface TemperatureBalance {
  readonly limit: number;
  /** Drift towards the target per minute: away from 0, and back towards 0. */
  readonly awayPerMin: number;
  readonly backPerMin: number;
  /** Cold / Hot from ±`mildAt`, Freezing / Overheating from ±`severeAt`. */
  readonly mildAt: number;
  readonly severeAt: number;
  /** Health lost per minute while Freezing or Overheating. */
  readonly severeDamagePerMin: number;
}

export interface ToxicityBalance {
  readonly max: number;
  /** Decay per minute while no source adds any. */
  readonly decayPerMin: number;
  /** Nauseous from here: no health regeneration. */
  readonly nauseousAt: number;
  /** Health lost per minute from `harmAt`, and from `severeAt` (instead). */
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
  /** An enclosed shelter blends the air `enclosedBlend` of the way towards `enclosedC`. */
  readonly enclosedC: number;
  readonly enclosedBlend: number;
  /** A covered shelter takes `shadeC` off air warmer than `shadeAboveC`. */
  readonly shadeAboveC: number;
  readonly shadeC: number;
  /** How many heat sources count (the strongest ones). */
  readonly heatSources: number;
  /** Cooling of the water around the body. */
  readonly waterC: number;
  /** Comfort range: gear warms up to `comfortMinC` and cools down to `comfortMaxC`. */
  readonly comfortMinC: number;
  readonly comfortMaxC: number;
  /** Temperature target per degree outside the comfort range. */
  readonly targetPerDegree: number;
}

/** Shelter test (docs « Abri ») and its effects on the air. */
export interface ShelterBalance {
  /** Seconds between two tests (a nearby edit tests again the next tick). */
  readonly checkSec: number;
  readonly maxCells: number;
  /** Distance from the head on each axis (at most 15). */
  readonly maxDistance: number;
  /** An edit within this many blocks (each axis) tests the shelter again. */
  readonly editRadius: number;
  /** Air toxicity factors. */
  readonly enclosedToxicity: number;
  readonly coveredToxicity: number;
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
  /** Weakened: damage dealt × `weakenedDamage`, for `weakenedSec`. */
  readonly weakenedSec: number;
  readonly weakenedDamage: number;
  /** Creatures ignore the player for these first seconds. */
  readonly untargetedSec: number;
}

/** Creature spawning (docs « Apparition »). */
export interface CreatureBalance {
  /** No hostile spawns before this tick of a world: its first 3 real minutes (`?grace=0`). */
  readonly spawnGraceTicks: number;
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
  readonly shelter: ShelterBalance;
  readonly water: WaterBalance;
  readonly consume: ConsumeBalance;
  readonly sleep: SleepBalance;
  readonly respawn: RespawnBalance;
  readonly creatures: CreatureBalance;
  readonly combat: CombatBalance;
}
