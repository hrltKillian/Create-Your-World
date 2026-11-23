import type { ModelDef } from '../../schema.ts';

/**
 * The explorer avatar: human proportions (head 6/16 wide, not a large cube), a hood, goggles and
 * a satchel. Units are 1/16 block from the feet centre; the model faces −z (north) at yaw 0.
 */
export const models = [
  {
    key: 'model:explorer',
    gait: 'biped',
    stride: 2.2,
    parts: [
      {
        name: 'legL',
        from: [-3, 0, -1.5],
        to: [-0.5, 13, 1.5],
        pivot: [-1.75, 13, 0],
        texture: 'tex:avatar_pants',
      },
      {
        name: 'legR',
        from: [0.5, 0, -1.5],
        to: [3, 13, 1.5],
        pivot: [1.75, 13, 0],
        texture: 'tex:avatar_pants',
      },
      {
        name: 'torso',
        from: [-3.5, 13, -2],
        to: [3.5, 22, 2],
        pivot: [0, 13, 0],
        texture: 'tex:avatar_jacket',
      },
      {
        name: 'armL',
        from: [-5.5, 12.5, -1],
        to: [-3.5, 21.5, 1],
        pivot: [-4.5, 21, 0],
        texture: 'tex:avatar_jacket',
        parent: 'torso',
      },
      {
        name: 'armR',
        from: [3.5, 12.5, -1],
        to: [5.5, 21.5, 1],
        pivot: [4.5, 21, 0],
        texture: 'tex:avatar_jacket',
        parent: 'torso',
      },
      {
        name: 'head',
        from: [-3, 22, -3],
        to: [3, 28, 3],
        pivot: [0, 22, 0],
        texture: 'tex:avatar_skin',
        parent: 'torso',
      },
      {
        name: 'hood',
        from: [-3.4, 24.5, -2.6],
        to: [3.4, 28.6, 3.4],
        pivot: [0, 22, 0],
        texture: 'tex:avatar_hood',
        parent: 'head',
      },
      {
        name: 'goggles',
        from: [-2.8, 24.6, -3.4],
        to: [2.8, 26, -2.9],
        pivot: [0, 22, 0],
        texture: 'tex:avatar_goggles',
        parent: 'head',
      },
      {
        name: 'satchel',
        from: [2.2, 13, 1.6],
        to: [4.8, 16.5, 3.2],
        pivot: [0, 13, 0],
        texture: 'tex:avatar_satchel',
        parent: 'torso',
      },
    ],
  },
] as const satisfies readonly ModelDef[];
