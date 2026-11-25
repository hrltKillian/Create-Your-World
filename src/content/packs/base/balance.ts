import type { BalanceDef } from '../../schema.ts';

/**
 * Survival numbers of the base pack (docs « Survie », « Joueur », « Eau potable », « Créatures et
 * combat »). Hunger goes with the player's efforts (the reference game's exhaustion and hidden
 * saturation); an idle player empties thirst in 16 min, then dies of thirst after about 21.6 min.
 */
export const balance: BalanceDef = {
  // The reference game's health and hunger (plan v3 « M30 »), in our units: a vital cell or a
  // ration pod is 10 points, its half 5 (one point of the reference game's 20).
  health: {
    max: 100,
    regenHungerAt: 90,
    regenThirstAt: 50,
    regenAmount: 5,
    regenSeconds: 4,
    fastRegenSeconds: 0.5,
    regenExhaustion: 6,
    lowAt: 25,
  },
  hunger: {
    max: 100,
    startSaturation: 25,
    exhaustionPerStep: 4,
    step: 5,
    exhaustion: {
      sprintPerBlock: 0.1,
      swimPerBlock: 0.01,
      jump: 0.05,
      sprintJump: 0.2,
      attack: 0.1,
      hurt: 0.1,
      mine: 0.005,
    },
    sprintFrom: 30,
    lowAt: 15,
    starveDamage: 5,
    starveSeconds: 4,
  },
  thirst: {
    max: 100,
    perMin: 6.25,
    sprintFactor: 1.5,
    lowAt: 20,
    emptyDamagePerMin: 18,
  },
  temperature: {
    limit: 100,
    awayPerMin: 16,
    backPerMin: 30,
    mildAt: 40,
    severeAt: 70,
    severeDamagePerMin: 20,
  },
  toxicity: {
    max: 100,
    decayPerMin: 3,
    harmAt: 65,
    harmPerMin: 10,
    severeAt: 90,
    severePerMin: 30,
  },
  breath: { seconds: 15, refillPerSec: 5, drowningPerSec: 5 },
  // The reference game's fire after lava: a few seconds, put out by water.
  fire: { minSeconds: 4, maxSeconds: 8, damagePerSec: 4 },
  // Plan v3 « M34 »: spells of 4 minutes (a fifth of a day), mostly clear.
  weather: {
    spellSeconds: 240,
    clearSpells: 2,
    weights: { clear: 55, rain: 25, storm: 10, fog: 10 },
    rainChillC: 4,
    snowChillC: 6,
    dim: { rain: 0.7, storm: 0.25, fog: 0.8 },
    lightningSeconds: 12,
    stormSpawns: 2,
  },
  fall: { safeBlocks: 3.5, damagePerBlock: 6 },
  climate: {
    altitudeFrom: 100,
    altitudePerBlock: 0.15,
    caveC: 12,
    caveDepth: 8,
    heatSources: 2,
    waterC: 8,
    comfortMinC: 10,
    comfortMaxC: 28,
    targetPerDegree: 5,
    sampleSec: 1,
    editRadius: 8,
  },
  water: { sipSec: 0.8 },
  consume: { moveFactor: 0.4 },
  sleep: { fromHour: 19.5, toHour: 5, wakeHour: 6, hunger: 10, thirst: 15, hostileRadius: 8 },
  respawn: {
    health: 60,
    hunger: 50,
    thirst: 50,
  },
  creatures: {
    spawnGraceTicks: 5400,
    needs: {
      hungerPerMin: 4,
      thirstPerMin: 5,
      seekBelow: 50,
      seekRadius: 16,
      plantFood: 25,
      meatFood: 50,
      drink: 60,
      regenPerMin: 6,
    },
    fall: { safeBlocks: 3, damagePerBlock: 2 },
  },
  combat: { hand: { damage: 2, cooldown: 0.4, reach: 3, knockback: 1 } },
  progression: {
    xpBase: 100,
    xpStep: 50,
    maxSkill: 5,
    tasks: 3,
    skills: {
      vitality: 10,
      endurance: 10,
      carrying: 4,
      metabolism: 0.06,
      resistance: 1.5,
      strength: 0.06,
    },
  },
};
