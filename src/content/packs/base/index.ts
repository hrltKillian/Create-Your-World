import type { ContentPack } from '../../schema.ts';
import { ambienceSfx } from './ambienceSfx.ts';
import { balance } from './balance.ts';
import { blocks } from './blocks.ts';
import { natureBlocks } from './blocksNature.ts';
import { stationBlocks } from './blocksStations.ts';
import { undergroundBlocks } from './blocksUnderground.ts';
import { colonyBlocks, colonyLoot, colonyStructures, colonyTextures } from './colony.ts';
import { creatureModels, creatureSkins } from './creatureModels.ts';
import { creatureSfx } from './creatureSfx.ts';
import { creatures } from './creatures.ts';
import { strings } from './i18n.en.ts';
import { consumableIcons, containerIcons, equipmentIcons } from './iconsGear.ts';
import { materialIcons, toolIcons } from './iconsTools.ts';
import { items } from './items.ts';
import { loot } from './loot.ts';
import { models } from './models.ts';
import { playerSfx } from './playerSfx.ts';
import { quests } from './quests.ts';
import { processes, recipes, stations } from './recipes.ts';
import { sfx } from './sfx.ts';
import { sky } from './sky.ts';
import { sounds } from './sounds.ts';
import { tasks } from './tasks.ts';
import { crackTextures, textures } from './textures.ts';
import { floraTextures } from './texturesFlora.ts';
import { tiers, toolNames } from './tiers.ts';
import { biomes, features, ores, worldgen } from './worldgen.ts';

/** The neutral placeholder content pack shipped with the game. */
export const basePack: ContentPack = {
  manifest: {
    id: 'base',
    version: 1,
    locale: 'en',
    textureSize: 32,
    bindings: {
      air: 'block:air',
      unknownBlock: 'block:unknown',
      unknownItem: 'item:unknown',
      spawnBiomes: ['biome:meadow', 'biome:forest'],
      avatarModel: 'model:explorer',
    },
  },
  blocks: [...blocks, ...natureBlocks, ...undergroundBlocks, ...stationBlocks, ...colonyBlocks],
  // Icons, cracks and creature skins go last so that block texture layers keep their indices.
  textures: [
    ...textures,
    ...floraTextures,
    ...colonyTextures,
    ...toolIcons,
    ...materialIcons,
    ...equipmentIcons,
    ...consumableIcons,
    ...containerIcons,
    ...crackTextures,
    ...creatureSkins,
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
  loot: [...loot, ...colonyLoot],
  recipes,
  processes,
  stations,
  creatures,
  balance,
  quests,
  tasks,
  sounds,
  sfx: [...sfx, ...playerSfx, ...ambienceSfx, ...creatureSfx],
  worldgen,
  sky,
  biomes,
  features,
  ores,
  structures: colonyStructures,
  models: [...models, ...creatureModels],
};
