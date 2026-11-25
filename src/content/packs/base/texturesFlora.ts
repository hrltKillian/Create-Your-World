import type { TextureDef } from '../../schema.ts';

/**
 * Textures of the flora of Veyra (plan v3 « M23 »): the bark, rings and leaves of each biome's
 * species, in colours a little off the Earth's (bark not quite brown, leaves not quite green), and
 * the biomes' plants. The Lanternwood and the Veilpine keep the base logs' textures (textures.ts).
 */
export const floraTextures = [
  {
    // Frostpine: slate bark, teal needles.
    key: 'tex:frostpine_bark',
    pattern: 'bark',
    palette: ['#2c333d', '#373f4a', '#424b58', '#4e5866'],
    seed: 401,
  },
  {
    key: 'tex:frostpine_rings',
    pattern: 'rings',
    palette: ['#424b58', '#8f9aa6', '#a1abb6', '#b3bcc6'],
    seed: 403,
  },
  {
    key: 'tex:frost_needles',
    pattern: 'leaves',
    palette: ['#2b6a6e', '#367d81', '#439195', '#53a6a9'],
    seed: 405,
    alpha: 'coverage',
  },
  {
    // Twistpine: olive bark, grey-green needles.
    key: 'tex:twistpine_bark',
    pattern: 'bark',
    palette: ['#3b3d20', '#494c28', '#585c31', '#686d3b'],
    seed: 407,
  },
  {
    key: 'tex:twistpine_rings',
    pattern: 'rings',
    palette: ['#585c31', '#9c9a68', '#adab78', '#bebb88'],
    seed: 409,
  },
  {
    key: 'tex:twist_needles',
    pattern: 'leaves',
    palette: ['#3c5744', '#486650', '#55775e', '#63886c'],
    seed: 411,
    alpha: 'coverage',
  },
  {
    // Mirror Willow: slate-blue bark, silver leaves.
    key: 'tex:willow_bark',
    pattern: 'bark',
    palette: ['#383c46', '#454a55', '#535864', '#626774'],
    seed: 413,
  },
  {
    key: 'tex:willow_rings',
    pattern: 'rings',
    palette: ['#535864', '#9aa0aa', '#acb2bb', '#bec4cc'],
    seed: 415,
  },
  {
    key: 'tex:willow_leaves',
    pattern: 'leaves',
    palette: ['#869a92', '#9aaea6', '#aec1ba', '#c3d4ce'],
    seed: 417,
    alpha: 'coverage',
  },
  {
    // Podtree: dark olive bark, ochre pods among the leaves.
    key: 'tex:pod_bark',
    pattern: 'bark',
    palette: ['#2c3820', '#384629', '#445432', '#51633c'],
    seed: 419,
  },
  {
    key: 'tex:pod_rings',
    pattern: 'rings',
    palette: ['#445432', '#8a8f5a', '#9ba06a', '#acb07a'],
    seed: 421,
  },
  {
    key: 'tex:pod_leaves',
    pattern: 'leaves',
    palette: ['#56662a', '#687a33', '#7c8e3d', '#c49a3a'],
    seed: 423,
    alpha: 'coverage',
  },
  {
    // Plants of Veyra.
    key: 'tex:amber_bell',
    pattern: 'cross',
    palette: ['#7a6a2a', '#c9a240', '#f0d27a'],
    seed: 425,
    alpha: 'coverage',
  },
  {
    key: 'tex:veil_fern',
    pattern: 'cross',
    palette: ['#24504c', '#33685f', '#4a8a7e'],
    seed: 427,
    alpha: 'coverage',
  },
  {
    key: 'tex:cap_sprout',
    pattern: 'cross',
    palette: ['#4a3a5e', '#8a6aa8', '#7fe0c8'],
    seed: 429,
    alpha: 'coverage',
  },
  {
    key: 'tex:reed',
    pattern: 'cross',
    palette: ['#5c6a32', '#7c8c44', '#a3b05a'],
    seed: 431,
    alpha: 'coverage',
  },
  {
    key: 'tex:frost_bulb',
    pattern: 'cross',
    palette: ['#4f7f8c', '#8fd0e4', '#e6fbff'],
    seed: 433,
    alpha: 'coverage',
  },
  {
    key: 'tex:crystal_sprout',
    pattern: 'cross',
    palette: ['#5a4a7a', '#b49cf0', '#f4ecff'],
    seed: 435,
    alpha: 'coverage',
  },
] as const satisfies readonly TextureDef[];
