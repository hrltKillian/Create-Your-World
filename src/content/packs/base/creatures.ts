import { type CreatureDef, HOSTILE_MAX_LIGHT } from '../../schema.ts';
import { voicesOf } from './creatureSfx.ts';
import type { PackI18nKey } from './i18n.en.ts';

type PackCreature = CreatureDef & { readonly nameKey: PackI18nKey };

/**
 * The five creatures (docs « Créatures et combat »): health, walk / run speeds and attacks follow
 * the creature table. Passive and defensive herds are placed when their column is first generated
 * and saved with it; hostiles only spawn in the dark and are never saved. Hostile creatures only
 * live in worlds with hostiles.
 */
export const creatures = [
  {
    // A long-legged grazer of the meadows: it bolts for 8 s when hurt or startled.
    key: 'creature:trotter',
    nameKey: 'creature.trotter',
    model: 'model:trotter',
    hitbox: [0.8, 1.3],
    health: 12,
    speed: { walk: 1.6, run: 5.8 },
    brain: 'grazer',
    category: 'passive',
    senses: { sight: 16, fovDeg: 240, hearing: 1 },
    traits: { fleeSec: 8, knockbackResist: 0.4 },
    spawn: [
      {
        biomes: ['biome:meadow', 'biome:forest'],
        when: 'day',
        where: 'surface',
        group: [2, 4],
        weight: 1,
      },
    ],
    agility: { groundAccel: 18, airAccel: 4, turnDegPerSec: 240 },
    stamina: { runSeconds: 10 },
    diet: { plants: ['block:tall_grass', 'block:berry_bush'] },
    loot: 'loot:trotter',
    sounds: voicesOf('trotter'),
  },
  {
    // A six-legged shaggy beast of the cold: it charges whoever hurts it, and its herd joins in.
    key: 'creature:shagback',
    nameKey: 'creature.shagback',
    model: 'model:shagback',
    hitbox: [0.95, 1.5],
    health: 26,
    speed: { walk: 1.3, run: 4.8 },
    brain: 'defender',
    category: 'defensive',
    attack: { damage: 6, reach: 1, windup: 0.6, cooldown: 2.5, knockback: 1.5 },
    senses: { sight: 16, fovDeg: 200, hearing: 1 },
    traits: { herdAlertRadius: 12, knockbackResist: 0.5 },
    spawn: [
      {
        biomes: ['biome:tundra', 'biome:highlands'],
        when: 'day',
        where: 'surface',
        group: [2, 3],
        weight: 1,
      },
    ],
    agility: { groundAccel: 14, airAccel: 4, turnDegPerSec: 150 },
    stamina: { runSeconds: 8 },
    diet: { plants: ['block:tall_grass', 'block:frost_lichen'] },
    loot: 'loot:shagback',
    sounds: voicesOf('shagback'),
  },
  {
    // A low night hunter with amber eyes: it freezes under the player's gaze, shuns the light and
    // burrows at dawn; it hits harder every night.
    key: 'creature:prowler',
    nameKey: 'creature.prowler',
    model: 'model:prowler',
    hitbox: [0.9, 0.75],
    health: 22,
    speed: { walk: 2.2, run: 5 },
    brain: 'stalker',
    category: 'hostile',
    attack: { damage: 7, reach: 1.8, windup: 0.4, cooldown: 2, knockback: 1 },
    senses: { sight: 24, fovDeg: 140, hearing: 1.25 },
    traits: {
      watchedSpeedMul: 0.3,
      lightAversion: 10,
      burrowAtDawn: true,
      escalation: { perDay: 0.05, maxDays: 10 },
    },
    spawn: [
      {
        biomes: '*',
        when: 'night',
        where: 'surface',
        maxLight: HOSTILE_MAX_LIGHT,
        group: [1, 1],
        weight: 3,
      },
      {
        biomes: '*',
        when: 'any',
        where: 'cave',
        maxLight: HOSTILE_MAX_LIGHT,
        group: [1, 2],
        weight: 2,
      },
    ],
    agility: { groundAccel: 20, airAccel: 4, turnDegPerSec: 200 },
    stamina: { runSeconds: 12 },
    diet: { meat: ['item:raw_meat'] },
    loot: 'loot:prowler',
    sounds: voicesOf('prowler'),
  },
  {
    // A small toxic mite of the marsh and the caves: packs close in zigzags.
    key: 'creature:swarmling',
    nameKey: 'creature.swarmling',
    model: 'model:swarmling',
    hitbox: [0.6, 0.55],
    health: 8,
    speed: { walk: 2.5, run: 6 },
    brain: 'swarmer',
    category: 'hostile',
    attack: { damage: 3, reach: 0.6, windup: 0.25, cooldown: 1.2, knockback: 0.3, toxicity: 8 },
    senses: { sight: 12, fovDeg: 160, hearing: 1.5 },
    spawn: [
      {
        biomes: ['biome:fungal_marsh'],
        when: 'night',
        where: 'surface',
        maxLight: HOSTILE_MAX_LIGHT,
        group: [3, 5],
        weight: 3,
      },
      {
        biomes: '*',
        when: 'any',
        where: 'cave',
        maxLight: HOSTILE_MAX_LIGHT,
        group: [3, 5],
        weight: 1,
      },
    ],
    agility: { groundAccel: 22, airAccel: 4, turnDegPerSec: 240 },
    stamina: { runSeconds: 8 },
    diet: { meat: ['item:raw_meat'] },
    loot: 'loot:swarmling',
    sounds: voicesOf('swarmling'),
  },
  {
    // An armoured desert grazer: it rams whoever comes within 6 blocks; its brow plate stops most
    // blows from the front and a wall stuns it.
    key: 'creature:shellback',
    nameKey: 'creature.shellback',
    model: 'model:shellback',
    hitbox: [0.95, 1.2],
    health: 45,
    speed: { walk: 1.2, run: 7 },
    brain: 'charger',
    category: 'territorial',
    attack: { damage: 12, reach: 1, windup: 0.8, cooldown: 3, knockback: 2 },
    senses: { sight: 10, fovDeg: 120, hearing: 0.5 },
    traits: { frontArmor: 0.6, wallStunSec: 1.5, territoryRadius: 6, knockbackResist: 0.8 },
    spawn: [
      { biomes: ['biome:ochre_desert'], when: 'any', where: 'surface', group: [1, 1], weight: 1 },
    ],
    agility: { groundAccel: 12, airAccel: 4, turnDegPerSec: 120 },
    stamina: { runSeconds: 6 },
    diet: { plants: ['block:dry_shrub', 'block:thornbush'] },
    loot: 'loot:shellback',
    sounds: voicesOf('shellback'),
  },
  {
    // The Capwood's grazer (plan v3 « M25 »): spore spots glow on its back; it bolts like a
    // Trotter, and grazes the cap sprouts and glowblooms under the giant mushrooms.
    key: 'creature:glimmerback',
    nameKey: 'creature.glimmerback',
    model: 'model:glimmerback',
    hitbox: [0.8, 1.3],
    health: 14,
    speed: { walk: 1.4, run: 5.4 },
    brain: 'grazer',
    category: 'passive',
    senses: { sight: 14, fovDeg: 240, hearing: 1.2 },
    traits: { fleeSec: 6, knockbackResist: 0.4 },
    spawn: [{ biomes: ['biome:capwood'], when: 'any', where: 'surface', group: [2, 3], weight: 1 }],
    agility: { groundAccel: 18, airAccel: 4, turnDegPerSec: 240 },
    stamina: { runSeconds: 9 },
    diet: { plants: ['block:cap_sprout', 'block:glowbloom', 'block:tall_grass'] },
    loot: 'loot:glimmerback',
    sounds: voicesOf('glimmerback'),
  },
  {
    // The Mirror Basin's wading bird: flocks stalk the shallows; hurt one and the flock pecks back.
    key: 'creature:reedwader',
    nameKey: 'creature.reedwader',
    model: 'model:reedwader',
    hitbox: [0.6, 1.7],
    health: 16,
    speed: { walk: 1.5, run: 5 },
    brain: 'defender',
    category: 'defensive',
    attack: { damage: 4, reach: 1.4, windup: 0.35, cooldown: 1.6, knockback: 0.8 },
    senses: { sight: 18, fovDeg: 220, hearing: 1 },
    traits: { herdAlertRadius: 10, knockbackResist: 0.3 },
    spawn: [
      { biomes: ['biome:lake_basin'], when: 'day', where: 'surface', group: [2, 4], weight: 1 },
    ],
    agility: { groundAccel: 16, airAccel: 5, turnDegPerSec: 260 },
    stamina: { runSeconds: 8 },
    diet: { plants: ['block:reed', 'block:tall_grass'] },
    loot: 'loot:reedwader',
    sounds: voicesOf('reedwader'),
  },
] as const satisfies readonly PackCreature[];
