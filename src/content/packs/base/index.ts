import type { ContentPack } from '../../schema.ts';
import { blocks } from './blocks.ts';
import { natureBlocks } from './blocksNature.ts';
import { undergroundBlocks } from './blocksUnderground.ts';
import { strings } from './i18n.en.ts';
import { itemIcons, items } from './items.ts';
import { loot } from './loot.ts';
import { models } from './models.ts';
import { sfx } from './sfx.ts';
import { sounds } from './sounds.ts';
import { crackTextures, textures } from './textures.ts';
import { tiers, toolNames } from './tiers.ts';
import { biomes, features, ores, worldgen } from './worldgen.ts';

/** The neutral placeholder content pack shipped with the game. */
export const basePack: ContentPack = {
  manifest: {
    id: 'base',
    version: 1,
    locale: 'en',
    textureSize: 16,
    bindings: {
      air: 'block:air',
      unknownBlock: 'block:unknown',
      spawnBiomes: ['biome:meadow', 'biome:forest'],
      avatarModel: 'model:explorer',
    },
  },
  blocks: [...blocks, ...natureBlocks, ...undergroundBlocks],
  // Icons and cracks go last so that block texture layers keep their indices.
  textures: [...textures, ...itemIcons, ...crackTextures],
  strings,
  tints: { grass: '#7fb04f', foliage: '#5f9a3e', water: '#3f76c4' },
  devScene: {
    ground: ['block:stone', 'block:stone', 'block:dirt', 'block:dirt', 'block:grass'],
    pond: { liquid: 'block:fresh_water', shore: 'block:sand' },
    tree: { log: 'block:broadleaf_log', leaves: 'block:foliage' },
    plant: 'block:tall_grass',
    showcaseFloor: 'block:planks',
  },
  arena: {
    cabin: {
      wall: 'block:planks',
      roof: 'block:planks',
      door: 'block:gate',
      window: 'block:glass',
    },
    pond: { liquid: 'block:fresh_water', shore: 'block:sand' },
    gravel: 'block:gravel',
    tree: { log: 'block:broadleaf_log', leaves: 'block:foliage' },
    oreWall: ['block:stone', 'block:copper_ore', 'block:darkstone', 'block:ochre_sandstone'],
  },
  items,
  tiers,
  toolNames,
  loot,
  sounds,
  sfx,
  worldgen,
  biomes,
  features,
  ores,
  models,
};
