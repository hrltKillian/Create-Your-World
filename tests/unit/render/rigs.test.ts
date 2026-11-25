import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { models } from '../../../src/content/packs/base/models.ts';
import {
  animate,
  createRig,
  type Motion,
  poseModel,
  prepareModel,
} from '../../../src/render/rigs.ts';

const explorer = prepareModel(models[0]!);
const names = explorer.model.parts.map((p) => p.name);

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

/** World-space centre of every part's box for a pose. */
function pose(motion: Partial<Motion>, crouchDrop = 0) {
  const rig = createRig();
  for (let i = 0; i < 60; i++) animate(rig, { ...still, ...motion });
  const centres = new Map<string, Vector3>();
  poseModel(
    explorer,
    rig,
    new Matrix4(),
    crouchDrop,
    (i, box) => centres.set(names[i]!, new Vector3(0.5, 0.5, 0.5).applyMatrix4(box)),
    [],
  );
  return { rig, centres };
}

describe('avatar rig', () => {
  it('lowers the upper body by exactly the crouch drop, children included', () => {
    const stand = pose({});
    const crouch = pose({ crouching: true }, 0.25);
    // Drop plus the torso's forward lean (0.42 rad about its pivot 9/16 below the head pivot).
    const lean = (9 / 16) * (1 - Math.cos(0.42));
    expect(stand.rig.headPivotY - crouch.rig.headPivotY).toBeCloseTo(0.25 + lean, 6);
    // Hood and goggles stay on the head, the head stays on the torso.
    for (const [child, parent] of [
      ['hood', 'head'],
      ['goggles', 'head'],
      ['head', 'torso'],
    ] as const) {
      const before = stand.centres.get(child)!.clone().sub(stand.centres.get(parent)!);
      const after = crouch.centres.get(child)!.clone().sub(crouch.centres.get(parent)!);
      if (child === 'head') {
        // The torso leans while crouching, so compare the pivot drop instead.
        expect(crouch.centres.get('head')!.y).toBeLessThan(stand.centres.get('head')!.y);
      } else {
        expect(after.distanceTo(before)).toBeLessThan(1e-9);
      }
    }
    // The legs stay planted.
    expect(crouch.centres.get('legL')!.y).toBeCloseTo(stand.centres.get('legL')!.y, 9);
  });

  it('raises the face when looking up and lowers it when looking down', () => {
    const level = pose({}).centres.get('goggles')!.y;
    expect(pose({ pitch: 0.8 }).centres.get('goggles')!.y).toBeGreaterThan(level);
    expect(pose({ pitch: -0.8 }).centres.get('goggles')!.y).toBeLessThan(level);
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
    expect(names[explorer.hand]).toBe('armR');
  });

  it('rejects a part listed before its parent', () => {
    const broken = {
      ...models[0]!,
      parts: [{ ...models[0]!.parts[5]!, parent: 'torso' }, ...models[0]!.parts],
    };
    expect(() => prepareModel(broken)).toThrow(/before its parent/);
  });
});
