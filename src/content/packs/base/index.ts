import type { ContentPack } from '../../schema.ts';
import { blocks } from './blocks.ts';
import { natureBlocks } from './blocksNature.ts';
import { strings } from './i18n.en.ts';
import { models } from './models.ts';
import { textures } from './textures.ts';
import { biomes, features, worldgen } from './worldgen.ts';

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
  blocks: [...blocks, ...natureBlocks],
  textures,
  strings,
  tints: { grass: '#7fb04f', foliage: '#5f9a3e', water: '#3f76c4' },
  devScene: {
    ground: ['block:stone', 'block:stone', 'block:dirt', 'block:dirt', 'block:grass'],
    pond: { liquid: 'block:fresh_water', shore: 'block:sand' },
    tree: { log: 'block:broadleaf_log', leaves: 'block:foliage' },
    plant: 'block:tall_grass',
    showcaseFloor: 'block:planks',
  },
  worldgen,
  biomes,
  features,
  models,
};
