import type {
  AmbienceDef,
  AmbientEvent,
  BlockSounds,
  SfxKey,
  SoundBindings,
  SoundMaterial,
} from '../../schema.ts';
import { AMBIENCE as A } from './ambienceSfx.ts';

const material = (m: SoundMaterial): BlockSounds => ({
  break: `sfx:break_${m}`,
  hit: `sfx:hit_${m}`,
  place: `sfx:place_${m}`,
  step: `sfx:step_${m}`,
});

/** An event of an ambience: its sound, every (min, max) seconds, (min, max) blocks away. */
const at = (sound: SfxKey, every: [number, number], distance: [number, number]): AmbientEvent => ({
  sound,
  every,
  distance,
});

/** An ambience: its bed and the events dropped into it. */
const amb = (bed: SfxKey, ...events: AmbientEvent[]): AmbienceDef => ({ bed, events });

const meadow = {
  day: amb(A.meadowDay, at(A.grassGust, [9, 22], [5, 14])),
  night: amb(A.meadowNight, at(A.grassGust, [18, 40], [6, 16]), at(A.twig, [25, 60], [6, 14])),
};
const forest = {
  day: amb(
    A.forestDay,
    at(A.leafGust, [7, 16], [4, 12]),
    at(A.twig, [14, 35], [4, 12]),
    at(A.creak, [18, 45], [6, 14]),
  ),
  night: amb(
    A.forestNight,
    at(A.leafGust, [12, 26], [5, 14]),
    at(A.creak, [15, 40], [6, 14]),
    at(A.twig, [20, 45], [4, 12]),
  ),
};
const cold = {
  day: amb(A.cold, at(A.snowGust, [6, 14], [4, 12])),
  night: amb(A.cold, at(A.snowGust, [5, 12], [4, 12])),
};

/**
 * Every sound of the game (plan v5 « M54 »), each a recipe of its own: one break, hit, place and
 * step a material, a stack picked up, steam off cooling lava, blows, the player's own, doors and
 * chests, fires, lava, the clock's bell, thunder near and far, the interface's, and the ambiences
 * of every biome by day and by night, caves, water and the rain by what is overhead.
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
  ui: {
    button: 'sfx:ui_button',
    tab: 'sfx:ui_tab',
    take: 'sfx:ui_take',
    put: 'sfx:ui_put',
    throw: 'sfx:ui_throw',
    craft: 'sfx:ui_craft',
    bag: { open: 'sfx:ui_bag_open', close: 'sfx:ui_bag_close' },
    map: { open: 'sfx:ui_map_open', close: 'sfx:ui_map_close' },
    book: { open: 'sfx:ui_book_open', close: 'sfx:ui_book_close' },
    menu: { open: 'sfx:ui_menu_open', close: 'sfx:ui_menu_close' },
  },
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
    swing: 'sfx:swing',
  },
  door: { open: 'sfx:door_open', close: 'sfx:door_close' },
  chest: { open: 'sfx:chest_open', close: 'sfx:chest_close' },
  lit: {
    'station:campfire': 'sfx:fire',
    'station:kiln': 'sfx:kiln',
    'station:bloomery': 'sfx:kiln',
  },
  burning: 'sfx:burning',
  lava: 'sfx:lava',
  clock: { dusk: 'sfx:dusk', dawn: 'sfx:dawn' },
  thunder: { near: 'sfx:thunder_near', far: 'sfx:thunder_far' },
  ambience: {
    biomes: {
      'biome:meadow': meadow,
      'biome:forest': forest,
      'biome:capwood': forest,
      'biome:lake_basin': {
        day: amb(A.lake, at(A.lap, [3, 8], [3, 10]), at(A.grassGust, [14, 30], [6, 14])),
        night: amb(A.lake, at(A.lap, [3, 8], [3, 10])),
      },
      'biome:fungal_marsh': {
        day: amb(A.marsh, at(A.mud, [3, 9], [3, 10]), at(A.drip, [6, 15], [2, 8])),
        night: amb(A.marsh, at(A.mud, [3, 8], [3, 10]), at(A.creak, [25, 60], [6, 14])),
      },
      'biome:tundra': cold,
      'biome:highlands': cold,
      'biome:ochre_desert': {
        day: amb(A.desertDay, at(A.sandGust, [7, 16], [4, 12])),
        night: amb(A.desertNight, at(A.sandGust, [14, 30], [5, 14])),
      },
    },
    fallback: meadow,
    cave: amb(A.cave, at(A.drip, [2, 6], [2, 10]), at(A.pebbles, [15, 40], [4, 14])),
    underwater: amb(A.underwater, at(A.rise, [2, 6], [1, 6])),
    rain: {
      open: amb(A.rainOpen, at(A.bigDrop, [1, 3], [1, 6])),
      water: amb(A.rainWater, at(A.bigDrop, [0.8, 2.5], [1, 6])),
      leaves: amb(A.rainLeaves, at(A.bigDrop, [0.6, 2], [1, 5])),
      roof: amb(A.rainRoof, at(A.gutter, [2, 5], [2, 6])),
    },
  },
};
