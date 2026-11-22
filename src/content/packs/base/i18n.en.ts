/** Display strings of the base pack (English). Keys are typed: a typo fails `tsc`. */
export const strings = {
  'block.air': 'Air',
  'block.unknown': 'Unknown Block',
  'block.worldrock': 'Worldrock',
  'block.stone': 'Stone',
  'block.darkstone': 'Darkstone',
  'block.dirt': 'Dirt',
  'block.grass': 'Grass',
  'block.sand': 'Sand',
  'block.gravel': 'Gravel',
  'block.clay': 'Clay',
  'block.broadleaf_log': 'Broadleaf Log',
  'block.foliage': 'Foliage',
  'block.planks': 'Planks',
  'block.glass': 'Glass',
  'block.fresh_water': 'Water',
  'block.tall_grass': 'Tall Grass',
  'block.torch': 'Torch',
  'block.gate': 'Gate',
  'block.kiln': 'Clay Kiln',
  'block.copper_ore': 'Copper Ore',
} as const;

export type PackI18nKey = keyof typeof strings;
