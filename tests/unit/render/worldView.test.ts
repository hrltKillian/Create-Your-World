import type { Material } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../../../src/render/CameraRig.ts';
import { PlayView } from '../../../src/render/PlayView.ts';
import type { SimView } from '../../../src/sim/host.ts';
import { emptyWorld } from '../../helpers/flatWorld.ts';
import { registry } from '../../helpers/registry.ts';
import { createTestWorldView, sceneMaterials } from '../../helpers/worldView.ts';

describe('WorldView', () => {
  it('precompiles the chunk materials, the play objects and the hand view', async () => {
    const { view, compiled } = createTestWorldView();
    const sim = { registry, world: emptyWorld(1) } as unknown as SimView;
    const play = new PlayView(view, sim, new CameraRig());
    const m = view.materials;
    const chunkMaterials: Material[] = [m.opaque, m.cutout, m.translucent];
    await view.precompile();
    expect(compiled.map((c) => c.camera)).toEqual([view.camera, play.hand.camera]);
    const [world, hand] = compiled.map((c) => c.materials);
    // No chunk is meshed yet: probes stand in for the three chunk materials.
    for (const material of chunkMaterials) expect(world!.has(material)).toBe(true);
    // The world box batch and the hidden overlays (outline, crack, ghost and its upper half).
    for (const material of sceneMaterials(play.batch.mesh)) expect(world!.has(material)).toBe(true);
    const overlays = sceneMaterials(play.overlay.group);
    expect(overlays.size).toBe(4);
    for (const material of overlays) expect(world!.has(material)).toBe(true);
    expect(hand).toEqual(sceneMaterials(play.hand.scene));
    expect(hand!.size).toBe(1);
    // The probes left the scene.
    const after = sceneMaterials(view.scene);
    for (const material of chunkMaterials) expect(after.has(material)).toBe(false);
  });

  it('adds the pose’s sprint widening to the field of view setting, and its roll', () => {
    const { view } = createTestWorldView();
    view.setFov(80);
    const pose = { x: 1, y: 2, z: 3, yaw: 0.5, pitch: -0.2 };
    view.setPose({ ...pose, roll: -0.07, fovOffset: 8 });
    expect([view.camera.fov, view.camera.rotation.z]).toEqual([88, -0.07]);
    expect(view.camera.projectionMatrix.elements[5]).toBeCloseTo(
      1 / Math.tan((44 * Math.PI) / 180),
    );
    // A new setting keeps the widening of the next pose; a pose without one shows the setting.
    view.setFov(90);
    view.setPose({ ...pose, roll: 0, fovOffset: 4 });
    expect(view.camera.fov).toBe(94);
    view.setPose(pose);
    expect([view.camera.fov, view.camera.rotation.z]).toEqual([90, 0]);
  });
});
