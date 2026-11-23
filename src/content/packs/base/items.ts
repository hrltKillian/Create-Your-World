import type { ItemDef, TexKey, TextureDef } from '../../schema.ts';
import type { PackI18nKey } from './i18n.en.ts';

type PackItem = ItemDef & { readonly nameKey: PackI18nKey };

/** Flint, then wood: outline, flint, flint highlight, dark wood, wood, cord. */
const FLINT_TOOL_PALETTE = ['#2b2a2e', '#4d4b52', '#7a7782', '#4a3020', '#7a5434', '#c8b27e'];

const icon = (key: TexKey, seed: number, mask: readonly string[]): TextureDef => ({
  key,
  pattern: 'icon',
  palette: FLINT_TOOL_PALETTE,
  seed,
  alpha: 'coverage',
  mask,
});

/** Item icons (16×16 masks, top row first). */
export const itemIcons = [
  icon('tex:icon_flint_knife', 101, [
    '................',
    '.............0..',
    '............020.',
    '...........0210.',
    '..........0210..',
    '.........0210...',
    '........0210....',
    '.......0210.....',
    '......0210......',
    '.....55.0.......',
    '....345.........',
    '...343..........',
    '..343...........',
    '.343............',
    '.33.............',
    '................',
  ]),
  icon('tex:icon_flint_hatchet', 103, [
    '................',
    '........000.....',
    '.......02210....',
    '......0222210...',
    '......02211550..',
    '.......0115430..',
    '..........343...',
    '.........343....',
    '........343.....',
    '.......343......',
    '......343.......',
    '.....343........',
    '....343.........',
    '...343..........',
    '...33...........',
    '................',
  ]),
  icon('tex:icon_flint_pickaxe', 107, [
    '................',
    '.....0000.......',
    '....022210......',
    '...02....10.....',
    '..00.....5410...',
    '..0.....543.10..',
    '........343..0..',
    '.......343...00.',
    '......343.....0.',
    '.....343........',
    '....343.........',
    '...343..........',
    '..343...........',
    '..33............',
    '................',
    '................',
  ]),
  icon('tex:icon_flint_spear', 109, [
    '................',
    '............000.',
    '...........0220.',
    '..........02210.',
    '...........510..',
    '..........54.0..',
    '.........343....',
    '........343.....',
    '.......343......',
    '......343.......',
    '.....343........',
    '....343.........',
    '...343..........',
    '..343...........',
    '.33.............',
    '................',
  ]),
];

/**
 * Items of the base pack besides the implicit block items. Flint tools have no recipe yet (M8);
 * the knife and the spear become weapons in M10.
 */
export const items = [
  {
    key: 'item:flint_knife',
    nameKey: 'item.flint_knife',
    icon: 'tex:icon_flint_knife',
    maxStack: 1,
  },
  {
    key: 'item:flint_hatchet',
    nameKey: 'item.flint_hatchet',
    icon: 'tex:icon_flint_hatchet',
    maxStack: 1,
    tool: { kind: 'axe', tier: 1, speed: 2, durability: 60 },
  },
  {
    key: 'item:flint_pickaxe',
    nameKey: 'item.flint_pickaxe',
    icon: 'tex:icon_flint_pickaxe',
    maxStack: 1,
    tool: { kind: 'pick', tier: 1, speed: 2, durability: 60 },
  },
  {
    key: 'item:flint_spear',
    nameKey: 'item.flint_spear',
    icon: 'tex:icon_flint_spear',
    maxStack: 1,
  },
  // A saved item whose key the pack no longer has (keeps that key): never stacks with another.
  {
    key: 'item:unknown',
    nameKey: 'item.unknown',
    icon: 'tex:unknown',
    maxStack: 1,
  },
] as const satisfies readonly PackItem[];
