import type { ModelDef } from '../../schema.ts';

/**
 * The crash survivor (plan v5 « M51 »): a pilot's suit in the colony's colours, torn and
 * scorched, a harness, the breathing mask hanging at the neck, a survival pack and its
 * bedroll on the back, gloves, laced boots, hair showing. Human proportions; units are 1/16
 * block from the feet centre; the model faces −z (north) at yaw 0. Skins at the world's
 * density (`pixels`): survivorSkins.ts.
 */
export const models = [
  {
    key: 'model:survivor',
    gait: 'biped',
    stride: 2.2,
    pixels: true,
    parts: [
      {
        name: 'legL',
        from: [-3, 0, -1.5],
        to: [0, 12, 1.5],
        pivot: [-1.5, 12, 0],
        texture: 'tex:survivor_leg_sides',
        faces: {
          front: 'tex:survivor_leg_body',
          back: 'tex:survivor_leg_body',
          top: 'tex:survivor_leg_caps',
          bottom: 'tex:survivor_leg_caps',
        },
      },
      {
        name: 'legR',
        from: [0, 0, -1.5],
        to: [3, 12, 1.5],
        pivot: [1.5, 12, 0],
        texture: 'tex:survivor_leg_sides',
        faces: {
          front: 'tex:survivor_leg_body',
          back: 'tex:survivor_leg_body',
          top: 'tex:survivor_leg_caps',
          bottom: 'tex:survivor_leg_caps',
        },
      },
      {
        name: 'torso',
        from: [-3.5, 12, -2],
        to: [3.5, 21, 2],
        pivot: [0, 12, 0],
        texture: 'tex:survivor_torso_sides',
        faces: {
          front: 'tex:survivor_torso_body',
          back: 'tex:survivor_torso_body',
          top: 'tex:survivor_torso_caps',
          bottom: 'tex:survivor_torso_caps',
        },
      },
      {
        name: 'armL',
        from: [-6, 12, -1.25],
        to: [-3.5, 21, 1.25],
        pivot: [-4.75, 20.5, 0],
        texture: 'tex:survivor_arm_sides',
        faces: {
          front: 'tex:survivor_arm_body',
          back: 'tex:survivor_arm_body',
          top: 'tex:survivor_arm_caps',
          bottom: 'tex:survivor_arm_caps',
        },
        parent: 'torso',
      },
      {
        name: 'armR',
        from: [3.5, 12, -1.25],
        to: [6, 21, 1.25],
        pivot: [4.75, 20.5, 0],
        texture: 'tex:survivor_arm_sides',
        faces: {
          front: 'tex:survivor_arm_body',
          back: 'tex:survivor_arm_body',
          top: 'tex:survivor_arm_caps',
          bottom: 'tex:survivor_arm_caps',
        },
        parent: 'torso',
      },
      {
        name: 'head',
        from: [-3, 21, -3],
        to: [3, 27, 3],
        pivot: [0, 21, 0],
        texture: 'tex:survivor_head_sides',
        faces: {
          front: 'tex:survivor_head_body',
          back: 'tex:survivor_head_body',
          top: 'tex:survivor_head_caps',
          bottom: 'tex:survivor_head_caps',
        },
        parent: 'torso',
      },
      {
        name: 'hair',
        from: [-3.25, 26, -3.25],
        to: [3.25, 27.5, 3.25],
        pivot: [0, 21, 0],
        texture: 'tex:survivor_hair_sides',
        faces: {
          front: 'tex:survivor_hair_body',
          back: 'tex:survivor_hair_body',
          top: 'tex:survivor_hair_caps',
          bottom: 'tex:survivor_hair_caps',
        },
        parent: 'head',
      },
      {
        name: 'mask',
        from: [-1.5, 19, -3],
        to: [1.5, 21, -2],
        pivot: [0, 12, 0],
        texture: 'tex:survivor_mask_sides',
        faces: {
          front: 'tex:survivor_mask_body',
          back: 'tex:survivor_mask_body',
          top: 'tex:survivor_mask_caps',
          bottom: 'tex:survivor_mask_caps',
        },
        parent: 'torso',
      },
      {
        name: 'pack',
        from: [-3, 13.5, 2],
        to: [3, 20.5, 4],
        pivot: [0, 12, 0],
        texture: 'tex:survivor_pack_sides',
        faces: {
          front: 'tex:survivor_pack_body',
          back: 'tex:survivor_pack_body',
          top: 'tex:survivor_pack_caps',
          bottom: 'tex:survivor_pack_caps',
        },
        parent: 'torso',
      },
      {
        name: 'roll',
        from: [-3.5, 20.5, 2.25],
        to: [3.5, 22, 3.75],
        pivot: [0, 12, 0],
        texture: 'tex:survivor_roll_sides',
        faces: {
          front: 'tex:survivor_roll_body',
          back: 'tex:survivor_roll_body',
          top: 'tex:survivor_roll_caps',
          bottom: 'tex:survivor_roll_caps',
        },
        parent: 'torso',
      },
    ],
  },
] as const satisfies readonly ModelDef[];
