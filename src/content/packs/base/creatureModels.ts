import type { ModelDef, ModelPart, TexKey, TextureDef } from '../../schema.ts';

type Vec = readonly [number, number, number];

/** A model box (1/16 block from the feet centre, facing −z); `opts` names its parent or glow. */
const part = (
  name: string,
  from: Vec,
  to: Vec,
  pivot: Vec,
  texture: TexKey,
  opts: { readonly parent?: string; readonly emissive?: true } = {},
): ModelPart => ({ name, from, to, pivot, texture, ...opts });

/** Creature skins: our own palettes on the block patterns. */
export const creatureSkins = [
  {
    key: 'tex:trotter_coat',
    pattern: 'speckle',
    palette: ['#8a6440', '#9a7149', '#a97f53', '#b88d5f'],
    seed: 301,
  },
  {
    key: 'tex:trotter_dark',
    pattern: 'speckle',
    palette: ['#3b2b1f', '#463427', '#52402f'],
    seed: 303,
  },
  {
    key: 'tex:trotter_pale',
    pattern: 'speckle',
    palette: ['#d8c8a8', '#e2d3b5', '#eadfc4'],
    seed: 305,
  },
  // Long vertical tufts.
  {
    key: 'tex:shagback_fur',
    pattern: 'bark',
    palette: ['#4a3d33', '#5a4a3d', '#6b5847', '#7c6752'],
    seed: 307,
  },
  {
    key: 'tex:shagback_hide',
    pattern: 'speckle',
    palette: ['#2f2925', '#3a332e', '#463e37'],
    seed: 309,
  },
  {
    key: 'tex:shagback_horn',
    pattern: 'speckle',
    palette: ['#a89a80', '#bcae92', '#cfc2a6'],
    seed: 311,
  },
  {
    key: 'tex:prowler_hide',
    pattern: 'speckle',
    palette: ['#23222e', '#2b2a38', '#343243', '#3d3a4e'],
    seed: 313,
  },
  // Its dorsal crest and jaw: rust streaks on black.
  {
    key: 'tex:prowler_crest',
    pattern: 'bark',
    palette: ['#1a1820', '#3d2a2e', '#5a3530', '#6e3a2c'],
    seed: 315,
  },
  // Amber eyes, drawn emissive.
  {
    key: 'tex:prowler_eye',
    pattern: 'speckle',
    palette: ['#d9780f', '#ee9420', '#ffb63e'],
    seed: 317,
  },
  {
    key: 'tex:swarmling_shell',
    pattern: 'speckle',
    palette: ['#1f2a1c', '#283624', '#31422c', '#3b4f34'],
    seed: 319,
  },
  // The toxic gland sac and mandibles: bubbling yellow-green.
  {
    key: 'tex:swarmling_sac',
    pattern: 'sludge',
    palette: ['#4a5a1a', '#62761f', '#9fb52a', '#c8d943', '#e6f27a'],
    seed: 321,
  },
  // Wavy bands of ochre armour, and a ringed plate on top of the dome.
  {
    key: 'tex:shellback_shell',
    pattern: 'ripple',
    palette: ['#5e4224', '#7a5a32', '#9a7442', '#b08850', '#c49c60'],
    seed: 323,
  },
  {
    key: 'tex:shellback_dome',
    pattern: 'rings',
    palette: ['#5e4224', '#7a5a32', '#9a7442', '#b08850', '#c49c60'],
    seed: 327,
  },
  {
    key: 'tex:shellback_skin',
    pattern: 'speckle',
    palette: ['#8f7458', '#9e8264', '#ad9171'],
    seed: 325,
  },
] as const satisfies readonly TextureDef[];

/**
 * The creatures' box models (docs « Animation »: pivots in 1/16, legs named for their gait, see
 * GAIT_LEGS). Short legs step faster: `stride` is radians per block.
 */
export const creatureModels = [
  {
    // Slender and long-legged: a long neck, a small head and tall upright ears.
    key: 'model:trotter',
    gait: 'quadruped',
    stride: 2.2,
    parts: [
      part('legFL', [-2.5, 0, -5], [-0.5, 9, -3], [-1.5, 9, -4], 'tex:trotter_dark'),
      part('legFR', [0.5, 0, -5], [2.5, 9, -3], [1.5, 9, -4], 'tex:trotter_dark'),
      part('legBL', [-2.5, 0, 3], [-0.5, 9, 5], [-1.5, 9, 4], 'tex:trotter_dark'),
      part('legBR', [0.5, 0, 3], [2.5, 9, 5], [1.5, 9, 4], 'tex:trotter_dark'),
      part('body', [-3, 8, -6.5], [3, 14, 6], [0, 11, 0], 'tex:trotter_coat'),
      part('neck', [-1.5, 12, -9], [1.5, 19, -5.5], [0, 13, -7], 'tex:trotter_coat', {
        parent: 'body',
      }),
      part('head', [-2, 17, -12], [2, 21, -7.5], [0, 18, -8], 'tex:trotter_coat', {
        parent: 'neck',
      }),
      part('muzzle', [-1.5, 17, -14], [1.5, 19.5, -12], [0, 18, -8], 'tex:trotter_pale', {
        parent: 'head',
      }),
      part('earL', [-3.5, 20, -8.5], [-1.5, 24.5, -7.5], [-2.5, 20.5, -8], 'tex:trotter_dark', {
        parent: 'head',
      }),
      part('earR', [1.5, 20, -8.5], [3.5, 24.5, -7.5], [2.5, 20.5, -8], 'tex:trotter_dark', {
        parent: 'head',
      }),
      part('tail', [-1, 10.5, 6], [1, 14, 8.5], [0, 14, 6], 'tex:trotter_pale', { parent: 'body' }),
    ],
  },
  {
    // Six legs under a shaggy barrel body with a hump, a low head and upturned horns.
    key: 'model:shagback',
    gait: 'hexapod',
    stride: 1.6,
    parts: [
      part('legFL', [-5.5, 0, -8.5], [-2.5, 9, -5.5], [-4, 9, -7], 'tex:shagback_hide'),
      part('legML', [-5.5, 0, -1.5], [-2.5, 9, 1.5], [-4, 9, 0], 'tex:shagback_hide'),
      part('legBL', [-5.5, 0, 5.5], [-2.5, 9, 8.5], [-4, 9, 7], 'tex:shagback_hide'),
      part('legFR', [2.5, 0, -8.5], [5.5, 9, -5.5], [4, 9, -7], 'tex:shagback_hide'),
      part('legMR', [2.5, 0, -1.5], [5.5, 9, 1.5], [4, 9, 0], 'tex:shagback_hide'),
      part('legBR', [2.5, 0, 5.5], [5.5, 9, 8.5], [4, 9, 7], 'tex:shagback_hide'),
      part('body', [-6, 8, -10], [6, 19, 10], [0, 13, 0], 'tex:shagback_fur'),
      part('hump', [-4.5, 19, -8], [4.5, 23, 3], [0, 19, 0], 'tex:shagback_fur', {
        parent: 'body',
      }),
      part('head', [-3.5, 9, -16], [3.5, 16, -9], [0, 14, -10], 'tex:shagback_hide', {
        parent: 'body',
      }),
      part('hornL', [-7, 14, -14], [-3.5, 16, -12], [0, 14, -10], 'tex:shagback_horn', {
        parent: 'head',
      }),
      part('hornR', [3.5, 14, -14], [7, 16, -12], [0, 14, -10], 'tex:shagback_horn', {
        parent: 'head',
      }),
      part('hornTipL', [-8, 16, -14], [-6, 19, -12], [0, 14, -10], 'tex:shagback_horn', {
        parent: 'hornL',
      }),
      part('hornTipR', [6, 16, -14], [8, 19, -12], [0, 14, -10], 'tex:shagback_horn', {
        parent: 'hornR',
      }),
      part('tail', [-1.5, 14, 10], [1.5, 17, 13], [0, 17, 10], 'tex:shagback_fur', {
        parent: 'body',
      }),
    ],
  },
  {
    // Low and four-legged: a long body under a dorsal crest, a flat wedge head with a jaw that
    // opens on the wind-up, amber eyes that glow in the dark and a long tail.
    key: 'model:prowler',
    gait: 'quadruped',
    stride: 2,
    parts: [
      part('legFL', [-3, 0, -7], [-1, 6, -5], [-2, 6, -6], 'tex:prowler_hide'),
      part('legFR', [1, 0, -7], [3, 6, -5], [2, 6, -6], 'tex:prowler_hide'),
      part('legBL', [-3, 0, 4.5], [-1, 6, 6.5], [-2, 6, 5.5], 'tex:prowler_hide'),
      part('legBR', [1, 0, 4.5], [3, 6, 6.5], [2, 6, 5.5], 'tex:prowler_hide'),
      part('body', [-3, 5, -8], [3, 10, 8], [0, 7.5, 0], 'tex:prowler_hide'),
      part('crest', [-1, 10, -6], [1, 11.5, 5], [0, 10, 0], 'tex:prowler_crest', {
        parent: 'body',
      }),
      part('head', [-3, 5.5, -13], [3, 10, -7.5], [0, 8, -8], 'tex:prowler_hide', {
        parent: 'body',
      }),
      part('jaw', [-2.5, 4, -12.5], [2.5, 5.5, -8], [0, 5.5, -8], 'tex:prowler_crest', {
        parent: 'head',
      }),
      part('eyeL', [-2.5, 8, -13.5], [-1, 9, -13], [0, 8, -8], 'tex:prowler_eye', {
        parent: 'head',
        emissive: true,
      }),
      part('eyeR', [1, 8, -13.5], [2.5, 9, -13], [0, 8, -8], 'tex:prowler_eye', {
        parent: 'head',
        emissive: true,
      }),
      part('tail', [-0.75, 7.5, 8], [0.75, 9, 17], [0, 8.5, 8], 'tex:prowler_hide', {
        parent: 'body',
      }),
    ],
  },
  {
    // A small six-legged mite with a swollen gland sac on its back and mandibles.
    key: 'model:swarmling',
    gait: 'hexapod',
    stride: 4.4,
    parts: [
      part('legFL', [-4.5, 0, -3], [-3, 3, -2], [-3.5, 3, -2.5], 'tex:swarmling_shell'),
      part('legML', [-4.5, 0, -0.5], [-3, 3, 0.5], [-3.5, 3, 0], 'tex:swarmling_shell'),
      part('legBL', [-4.5, 0, 2], [-3, 3, 3], [-3.5, 3, 2.5], 'tex:swarmling_shell'),
      part('legFR', [3, 0, -3], [4.5, 3, -2], [3.5, 3, -2.5], 'tex:swarmling_shell'),
      part('legMR', [3, 0, -0.5], [4.5, 3, 0.5], [3.5, 3, 0], 'tex:swarmling_shell'),
      part('legBR', [3, 0, 2], [4.5, 3, 3], [3.5, 3, 2.5], 'tex:swarmling_shell'),
      part('body', [-3, 2, -3.5], [3, 6, 4], [0, 4, 0], 'tex:swarmling_shell'),
      part('sac', [-2, 6, -1.5], [2, 8.5, 3], [0, 6, 0], 'tex:swarmling_sac', { parent: 'body' }),
      part('head', [-2, 2.5, -6.5], [2, 5.5, -3.5], [0, 4, -3.5], 'tex:swarmling_shell', {
        parent: 'body',
      }),
      part('mandL', [-2, 2, -8], [-0.5, 3, -6.5], [-1, 2.5, -6.5], 'tex:swarmling_sac', {
        parent: 'head',
      }),
      part('mandR', [0.5, 2, -8], [2, 3, -6.5], [1, 2.5, -6.5], 'tex:swarmling_sac', {
        parent: 'head',
      }),
    ],
  },
  {
    // A domed shell of ochre plates on stubby legs, a heavy brow plate over the head.
    key: 'model:shellback',
    gait: 'quadruped',
    stride: 2.6,
    parts: [
      part('legFL', [-6.5, 0, -7], [-2.5, 6, -3], [-4.5, 6, -5], 'tex:shellback_skin'),
      part('legFR', [2.5, 0, -7], [6.5, 6, -3], [4.5, 6, -5], 'tex:shellback_skin'),
      part('legBL', [-6.5, 0, 3], [-2.5, 6, 7], [-4.5, 6, 5], 'tex:shellback_skin'),
      part('legBR', [2.5, 0, 3], [6.5, 6, 7], [4.5, 6, 5], 'tex:shellback_skin'),
      part('belly', [-6, 4, -7.5], [6, 7, 8], [0, 5.5, 0], 'tex:shellback_skin'),
      part('shell', [-7.5, 7, -9], [7.5, 15, 10], [0, 11, 0], 'tex:shellback_shell', {
        parent: 'belly',
      }),
      part('dome', [-5.5, 15, -6.5], [5.5, 19, 7.5], [0, 15, 0], 'tex:shellback_dome', {
        parent: 'shell',
      }),
      part('head', [-3.5, 4.5, -14], [3.5, 10, -8], [0, 7.5, -8], 'tex:shellback_skin', {
        parent: 'belly',
      }),
      part('brow', [-4.5, 8.5, -15], [4.5, 12.5, -10], [0, 7.5, -8], 'tex:shellback_shell', {
        parent: 'head',
      }),
      part('tail', [-1.5, 5, 9], [1.5, 8, 14], [0, 7, 9], 'tex:shellback_skin', {
        parent: 'belly',
      }),
    ],
  },
] as const satisfies readonly ModelDef[];
