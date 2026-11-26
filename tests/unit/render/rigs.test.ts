import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { models } from '../../../src/content/packs/base/models.ts';
import type { ModelDef } from '../../../src/content/schema.ts';
import {
  animate,
  createRig,
  type Motion,
  poseModel,
  prepareModel,
} from '../../../src/render/rigs.ts';

const survivor = prepareModel(models[0]!);
const names = survivor.model.parts.map((p) => p.name);

const still: Motion = {
  distance: 0,
  speed: 0,
  onGround: true,
  crouching: false,
  swimming: false,
  pitch: 0,
  striking: false,
  dt: 1 / 60,
};

/** World-space centre of every part's box for a pose, and the middle of the head's face. */
function pose(motion: Partial<Motion>, crouchDrop = 0) {
  const rig = createRig();
  for (let i = 0; i < 60; i++) animate(rig, { ...still, ...motion });
  const centres = new Map<string, Vector3>();
  const face = new Vector3();
  poseModel(
    survivor,
    rig,
    new Matrix4(),
    crouchDrop,
    (i, box) => {
      centres.set(names[i]!, new Vector3(0.5, 0.5, 0.5).applyMatrix4(box));
      // The front face (−z, where the model looks) of the head.
      if (names[i] === 'head') face.set(0.5, 0.5, 0).applyMatrix4(box);
    },
    [],
  );
  return { rig, centres, face };
}

describe('avatar rig', () => {
  it('lowers the upper body by exactly the crouch drop, children included', () => {
    const stand = pose({});
    const crouch = pose({ crouching: true }, 0.25);
    // Drop plus the torso's forward lean (0.42 rad about its pivot 9/16 below the head pivot).
    const lean = (9 / 16) * (1 - Math.cos(0.42));
    expect(stand.rig.headPivotY - crouch.rig.headPivotY).toBeCloseTo(0.25 + lean, 6);
    // The hair stays on the head, the mask, pack and bedroll on the torso, the head on the torso.
    for (const [child, parent] of [
      ['hair', 'head'],
      ['mask', 'torso'],
      ['pack', 'torso'],
      ['roll', 'torso'],
      ['head', 'torso'],
    ] as const) {
      const before = stand.centres.get(child)!.clone().sub(stand.centres.get(parent)!);
      const after = crouch.centres.get(child)!.clone().sub(crouch.centres.get(parent)!);
      if (child === 'head') {
        // The torso leans while crouching, so compare the pivot drop instead.
        expect(crouch.centres.get('head')!.y).toBeLessThan(stand.centres.get('head')!.y);
      } else if (parent === 'torso') {
        // Carried by the leaning torso: turned with it, as far from it as ever.
        expect(after.length()).toBeCloseTo(before.length(), 9);
      } else {
        expect(after.distanceTo(before)).toBeLessThan(1e-9);
      }
    }
    // The legs stay planted.
    expect(crouch.centres.get('legL')!.y).toBeCloseTo(stand.centres.get('legL')!.y, 9);
  });

  it('raises the face when looking up and lowers it when looking down', () => {
    const level = pose({}).face.y;
    expect(pose({ pitch: 0.8 }).face.y).toBeGreaterThan(level);
    expect(pose({ pitch: -0.8 }).face.y).toBeLessThan(level);
  });

  it('swings the limbs when walking and rests when idle', () => {
    const rig = createRig();
    for (let i = 0; i < 60; i++) animate(rig, { ...still, distance: 4.3 / 60, speed: 4.3 });
    expect((rig.amplitude * 180) / Math.PI).toBeGreaterThan(20);
    for (let i = 0; i < 60; i++) animate(rig, still);
    expect((rig.amplitude * 180) / Math.PI).toBeLessThan(2);
  });

  it('raises the right arm into a chopping strike pose while primary is held', () => {
    const rig = createRig();
    for (let i = 0; i < 30; i++) animate(rig, { ...still, striking: true });
    expect(rig.strike).toBeGreaterThan(0.9);
    const raised: number[] = [];
    for (let i = 0; i < 20; i++) {
      animate(rig, { ...still, striking: true });
      raised.push(rig.angles.armR!);
    }
    // Forward and up (negative angles), chopping between two heights; the left arm stays down.
    expect(Math.max(...raised)).toBeLessThan(-0.6);
    expect(Math.max(...raised) - Math.min(...raised)).toBeGreaterThan(0.5);
    expect(Math.abs(rig.angles.armL!)).toBeLessThan(0.1);
    for (let i = 0; i < 30; i++) animate(rig, still);
    expect(rig.strike).toBeLessThan(0.05);
    expect(Math.abs(rig.angles.armR!)).toBeLessThan(0.15);
  });

  it('finds the arm that holds items', () => {
    expect(names[survivor.hand]).toBe('armR');
  });

  it('rejects a part listed before its parent', () => {
    const broken = {
      ...models[0]!,
      parts: [{ ...models[0]!.parts[5]!, parent: 'torso' }, ...models[0]!.parts],
    };
    expect(() => prepareModel(broken)).toThrow(/before its parent/);
  });
});

describe('rest rotations and yaws (plan v5 « M52 »)', () => {
  const tail = {
    key: 'model:test',
    gait: 'biped',
    stride: 1,
    parts: [
      { name: 'legL', from: [-2, 0, -1], to: [-1, 4, 1], pivot: [-1.5, 4, 0], texture: 'tex:x' },
      { name: 'legR', from: [1, 0, -1], to: [2, 4, 1], pivot: [1.5, 4, 0], texture: 'tex:x' },
      {
        name: 'tail',
        from: [0, 0, 0],
        to: [1, 1, 16],
        pivot: [0, 0, 0],
        rotation: [0, 90, 0],
        texture: 'tex:x',
      },
    ],
  } as const satisfies ModelDef;

  function centreOf(yaw: number): Vector3 {
    const centre = new Vector3();
    poseModel(
      prepareModel(tail),
      { angles: {}, yaws: { tail: yaw }, headPivotY: 0 },
      new Matrix4(),
      0,
      (i, box) => {
        if (i === 2) centre.set(0.5, 0.5, 0.5).applyMatrix4(box);
      },
      [],
    );
    return centre.multiplyScalar(16);
  }

  it('turns a part by its rest rotation about its pivot, then by its yaw', () => {
    // A tail along +z turned a quarter about y lies along +x; a quarter more, along −z.
    const rest = centreOf(0);
    expect([rest.x, rest.y, rest.z].map((v) => Math.round(v * 100) / 100)).toEqual([8, 0.5, -0.5]);
    const turned = centreOf(Math.PI / 2);
    expect([turned.x, turned.y, turned.z].map((v) => Math.round(v * 100) / 100)).toEqual([
      -0.5, 0.5, -8,
    ]);
  });
});
