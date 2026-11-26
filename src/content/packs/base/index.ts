import type { BlockDef, ContentPack } from '../../schema.ts';
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
import { buildingIcons } from './iconsBuilding.ts';
import { containerIcons } from './iconsContainers.ts';
import { fixtureIcons } from './iconsFixtures.ts';
import { consumableIcons } from './iconsFood.ts';
import { equipmentIcons } from './iconsGear.ts';
import { leafIcons } from './iconsLeaves.ts';
import { materialIcons } from './iconsMaterials.ts';
import { metalToolIcons } from './iconsMetalTools.ts';
import { natureIcons } from './iconsNature.ts';
import { plantIcons } from './iconsPlants.ts';
import { rockIcons } from './iconsRock.ts';
import { shrubIcons } from './iconsShrubs.ts';
import { soilIcons } from './iconsSoil.ts';
import { stationIcons } from './iconsStations.ts';
import { toolIcons } from './iconsTools.ts';
import { treeIcons } from './iconsTrees.ts';
import { wearIcons } from './iconsWear.ts';
import { items } from './items.ts';
import { loot } from './loot.ts';
import { models } from './models.ts';
import { playerSfx } from './playerSfx.ts';
import { quests } from './quests.ts';
import { processes, recipes, stations } from './recipes.ts';
import { sfx } from './sfx.ts';
import { sky } from './sky.ts';
import { sounds } from './sounds.ts';
import { survivorSkins } from './survivorSkins.ts';
import { tasks } from './tasks.ts';
import { crackTextures, textures } from './textures.ts';
import { floraTextures } from './texturesFlora.ts';
import { tiers, toolNames } from './tiers.ts';
import { biomes, features, ores, worldgen } from './worldgen.ts';

/** The neutral placeholder content pack shipped with the game. */
/** The blocks' drawn icons (plan v5 « M50 »): each block's item shows its art in slots. */
const blockIcons = [
  ...soilIcons,
  ...rockIcons,
  ...treeIcons,
  ...leafIcons,
  ...buildingIcons,
  ...stationIcons,
  ...fixtureIcons,
  ...plantIcons,
  ...shrubIcons,
];
const withArt = (block: BlockDef): BlockDef => {
  const icon = blockIcons.find((b) => b.block === block.key);
  return icon ? { ...block, item: { ...block.item, art: icon.texture.key } } : block;
};

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
      avatarModel: 'model:survivor',
      fire: 'block:fire',
    },
  },
  blocks: [...blocks, ...natureBlocks, ...undergroundBlocks, ...stationBlocks, ...colonyBlocks].map(
    withArt,
  ),
  // Icons, cracks and creature skins go last so that block texture layers keep their indices.
  textures: [
    ...textures,
    ...floraTextures,
    ...colonyTextures,
    ...toolIcons,
    ...metalToolIcons,
    ...natureIcons,
    ...materialIcons,
    ...equipmentIcons,
    ...wearIcons,
    ...consumableIcons,
    ...containerIcons,
    ...survivorSkins,
    ...crackTextures,
  ],
  icons: blockIcons.map((b) => b.texture),
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
  skins: creatureSkins,
};
