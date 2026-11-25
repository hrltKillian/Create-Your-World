import type { BlockSounds, SoundBindings, SoundMaterial } from '../../schema.ts';

const material = (m: SoundMaterial): BlockSounds => ({
  break: `sfx:break_${m}`,
  hit: `sfx:hit_${m}`,
  place: `sfx:place_${m}`,
  step: `sfx:step_${m}`,
});

/** Ambient loops shared by several biomes (ambienceSfx.ts). */
export const LOOPS = {
  insectsDay: 'sfx:amb_insects_day',
  insectsNight: 'sfx:amb_insects_night',
  marsh: 'sfx:amb_marsh',
  wind: 'sfx:amb_wind',
  sand: 'sfx:amb_sand',
  cave: 'sfx:amb_cave',
  bubbles: 'sfx:amb_bubbles',
  rain: 'sfx:amb_rain',
} as const;

const insects = { day: LOOPS.insectsDay, night: LOOPS.insectsNight } as const;
const windy = { day: LOOPS.wind, night: LOOPS.wind } as const;

/**
 * One break, hit, place and step sound per sound material, the pickup sound, the UI click and the
 * craft, the blows of combat, the player's own sounds, doors and chests, lit stations, the dusk
 * and dawn stingers, the thunder, and the ambient loops of each biome (insects, wind, sand), caves
 * (drips), water (bubbles) and the rain.
 */
export const sounds: SoundBindings = {
  blocks: {
    stone: material('stone'),
    soil: material('soil'),
    sand: material('sand'),
    gravel: material('gravel'),
    wood: material('wood'),
    leaves: material('leaves'),
    glass: material('glass'),
    water: material('water'),
    metal: material('metal'),
    cloth: material('cloth'),
  },
  pickup: 'sfx:pickup',
  hardens: 'sfx:hiss',
  click: 'sfx:click',
  craft: 'sfx:craft',
  combat: { hit: 'sfx:melee_hit', hurt: 'sfx:player_hurt' },
  player: {
    jump: 'sfx:jump',
    land: 'sfx:land',
    splash: 'sfx:splash',
    swim: 'sfx:swim',
    eat: 'sfx:eat',
    drink: 'sfx:drink',
    heartbeat: 'sfx:heartbeat',
    death: 'sfx:player_death',
  },
  door: { open: 'sfx:door_open', close: 'sfx:door_close' },
  chest: { open: 'sfx:chest_open', close: 'sfx:chest_close' },
  lit: {
    'station:campfire': 'sfx:fire',
    'station:kiln': 'sfx:kiln',
    'station:bloomery': 'sfx:kiln',
  },
  clock: { dusk: 'sfx:dusk', dawn: 'sfx:dawn' },
  thunder: 'sfx:thunder',
  ambience: {
    biomes: {
      'biome:meadow': insects,
      'biome:forest': insects,
      'biome:lake_basin': insects,
      'biome:fungal_marsh': { day: LOOPS.marsh, night: LOOPS.marsh },
      'biome:tundra': windy,
      'biome:highlands': windy,
      'biome:ochre_desert': { day: LOOPS.sand, night: LOOPS.wind },
    },
    fallback: insects,
    cave: LOOPS.cave,
    underwater: LOOPS.bubbles,
    rain: LOOPS.rain,
  },
};
