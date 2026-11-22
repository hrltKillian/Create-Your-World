import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { buildRegistry, FLAG_SOLID } from '../../../src/content/registry.ts';
import { CameraRig } from '../../../src/render/CameraRig.ts';
import { createPlayer } from '../../../src/sim/player.ts';
import { VoxelWorld } from '../../../src/world/VoxelWorld.ts';

const registry = buildRegistry(basePack);
const STONE = registry.defaultState('block:stone');
const GRASS_PLANT = registry.defaultState('block:tall_grass');

function world(): VoxelWorld {
  const w = new VoxelWorld(registry.air, registry.unknownBlock);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.ensureColumn(cx, cz);
  for (let x = -40; x < 40; x++) for (let z = -40; z < 40; z++) w.setBlock(x, 63, z, STONE);
  return w;
}

function solidAt(w: VoxelWorld, x: number, y: number, z: number): boolean {
  const state = w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  return (registry.tables.flags[state]! & FLAG_SOLID) !== 0;
}

/** Third-person pose after the camera settles (2 s of 60 fps frames). */
function settle(w: VoxelWorld, x: number, y: number, z: number, yaw: number, pitch: number) {
  const player = createPlayer(1, x, y, z, 2);
  const rig = new CameraRig();
  rig.mode = 'third';
  rig.yaw = yaw;
  rig.pitch = pitch;
  for (let i = 0; i < 120; i++) rig.update(player, 1, w, registry.tables, 1 / 60);
  return rig;
}

/** The camera and the points 0.06 around it (near plane) are outside solid blocks. */
function clear(w: VoxelWorld, rig: CameraRig): boolean {
  const { x, y, z } = rig.pose;
  const d = 0.06;
  return [
    [0, 0, 0],
    [d, 0, 0],
    [-d, 0, 0],
    [0, d, 0],
    [0, -d, 0],
    [0, 0, d],
    [0, 0, -d],
  ].every(([a, b, c]) => !solidAt(w, x + a!, y + b!, z + c!));
}

describe('third-person camera', () => {
  it('sits about 4 m behind and 0.5 m above the eye in the open, through plants', () => {
    const w = world();
    for (let z = 0; z < 8; z++) w.setBlock(0, 64, z, GRASS_PLANT);
    const rig = settle(w, 0.5, 64, 0.5, 0, 0);
    expect(rig.distance).toBeCloseTo(Math.hypot(4, 0.5), 2);
    expect(rig.pose.z).toBeCloseTo(0.5 + 4, 2);
    expect(rig.pose.y).toBeCloseTo(64 + 1.62 + 0.5, 2);
  });

  it('stops in front of a wall 2 m behind the player', () => {
    const w = world();
    for (let x = -3; x <= 3; x++) for (let y = 64; y < 69; y++) w.setBlock(x, y, 2, STONE);
    const rig = settle(w, 0.5, 64, 0, 0, 0);
    expect(rig.distance).toBeLessThan(2);
    expect(rig.pose.z).toBeLessThan(2 - 0.05);
    expect(clear(w, rig)).toBe(true);
  });

  it('stays out of a wall the player is leaning against', () => {
    const w = world();
    for (let x = -3; x <= 3; x++) for (let y = 64; y < 69; y++) w.setBlock(x, y, 1, STONE);
    const rig = settle(w, 0.5, 64, 0.7, 0, 0);
    expect(clear(w, rig)).toBe(true);
    expect(rig.distance).toBeLessThan(0.3);
  });

  it('never enters the rock of a two-high, one-wide tunnel, whatever the view', () => {
    const w = world();
    for (let x = -4; x <= 4; x++) {
      for (let z = -30; z <= 30; z++) {
        for (let y = 64; y <= 67; y++) if (x !== 0 || y >= 66) w.setBlock(x, y, z, STONE);
      }
    }
    for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 12) {
      for (let pitch = -1.4; pitch <= 1.4; pitch += 0.35) {
        const rig = settle(w, 0.5, 64, 0.5, yaw, pitch);
        expect(clear(w, rig), `yaw ${yaw.toFixed(2)} pitch ${pitch.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('stays out of a low ceiling while crouching', () => {
    const w = world();
    for (let x = -4; x <= 4; x++) for (let z = -8; z <= 8; z++) w.setBlock(x, 66, z, STONE);
    const player = createPlayer(1, 0.5, 64, 0.5, 2);
    player.body.crouching = true;
    for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 6) {
      for (const pitch of [-1.2, -0.4, 0, 0.6, 1.2]) {
        const rig = new CameraRig();
        rig.mode = 'third';
        rig.yaw = yaw;
        rig.pitch = pitch;
        for (let i = 0; i < 120; i++) rig.update(player, 1, w, registry.tables, 1 / 60);
        expect(clear(w, rig)).toBe(true);
      }
    }
  });
});
