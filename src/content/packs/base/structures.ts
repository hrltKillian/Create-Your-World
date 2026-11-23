import type { StructureDef } from '../../schema.ts';

/*
 * Structures of the base pack (docs « Génération » step 8). Layers go from the ground up, rows from
 * north to south, characters from west to east; `.` is the natural ground, then air.
 * `C` marks a chest, filled from the structure's loot table when it is generated.
 */
export const structures = [
  {
    // A lean-to with a broken roof, a crate under it, a fire pit and a bench.
    key: 'structure:camp',
    biomes: ['biome:meadow', 'biome:forest', 'biome:ochre_desert'],
    chance: 0.15,
    layers: [
      [
        '...........',
        '.PPPPP.....',
        '.PPPPP.....',
        '.PPPPP.DDD.',
        '...DDDDDGD.',
        '.......DDD.',
        '.......DDD.',
        '...........',
        '...........',
      ],
      [
        '...........',
        '.LPPPL.....',
        '.C.........',
        '.L...L..S..',
        '.......S.S.',
        '........S..',
        '.......lll.',
        '...........',
        '.lll.......',
      ],
      [
        '...........',
        '.LP.PL.....',
        '...........',
        '.L...L.....',
        '...........',
        '...........',
        '...........',
        '...........',
        '...........',
      ],
      [
        '...........',
        '.PPPPP.....',
        '.PP.PP.....',
        '.PPPP......',
        '...........',
        '...........',
        '...........',
        '...........',
        '...........',
      ],
    ],
    legend: {
      P: 'block:planks',
      L: 'block:broadleaf_log[axis=y]',
      l: 'block:broadleaf_log[axis=x]',
      D: 'block:dirt',
      G: 'block:gravel',
      S: 'block:stone',
      C: 'block:chest[facing4=e]',
    },
    lootTables: { C: 'loot:camp' },
  },
  {
    // A pile of stones on a gravel bed, a chest buried in its heart.
    key: 'structure:cairn',
    biomes: ['biome:tundra', 'biome:highlands', 'biome:fungal_marsh'],
    chance: 0.1,
    layers: [
      ['.......', '..GGG..', '.GSSSG.', '.GSSSG.', '.GSSSG.', '..GGG..', '.......'],
      ['.......', '...S...', '..SSS..', '.SSCSS.', '..SSS..', '...S...', '.......'],
      ['.......', '.......', '...S...', '..SSS..', '...S...', '.......', '.......'],
      ['.......', '.......', '.......', '...S...', '.......', '.......', '.......'],
      ['.......', '.......', '.......', '...S...', '.......', '.......', '.......'],
    ],
    legend: {
      S: 'block:stone',
      G: 'block:gravel',
      C: 'block:chest[facing4=s]',
    },
    lootTables: { C: 'loot:cairn' },
  },
] as const satisfies readonly StructureDef[];
