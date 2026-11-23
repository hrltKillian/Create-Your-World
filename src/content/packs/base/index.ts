import type { ContentPack } from '../../schema.ts';
import { balance } from './balance.ts';
import { blocks } from './blocks.ts';
import { natureBlocks } from './blocksNature.ts';
import { stationBlocks } from './blocksStations.ts';
import { undergroundBlocks } from './blocksUnderground.ts';
import { strings } from './i18n.en.ts';
import { consumableIcons, containerIcons, equipmentIcons } from './iconsGear.ts';
import { materialIcons, toolIcons } from './iconsTools.ts';
import { items } from './items.ts';
import { creatures, loot } from './loot.ts';
import { models } from './models.ts';
import { objectives } from './objectives.ts';
import { processes, recipes, stations } from './recipes.ts';
import { sfx } from './sfx.ts';
import { sounds } from './sounds.ts';
import { structures } from './structures.ts';
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
      unknownItem: 'item:unknown',
      spawnBiomes: ['biome:meadow', 'biome:forest'],
      avatarModel: 'model:explorer',
    },
  },
  blocks: [...blocks, ...natureBlocks, ...undergroundBlocks, ...stationBlocks],
  // Icons and cracks go last so that block texture layers keep their indices.
  textures: [
    ...textures,
    ...toolIcons,
    ...materialIcons,
    ...equipmentIcons,
    ...consumableIcons,
    ...containerIcons,
    ...crackTextures,
  ],
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
    workshop: ['block:workbench', 'block:kiln', 'block:campfire', 'block:chest'],
  },
  items,
  tiers,
  toolNames,
  loot,
  recipes,
  processes,
  stations,
  creatures,
  balance,
  objectives,
  sounds,
  sfx,
  worldgen,
  biomes,
  features,
  ores,
  structures,
  models,
};
