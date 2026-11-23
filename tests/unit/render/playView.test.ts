import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { CRACK_STAGES } from '../../../src/content/schema.ts';
import { BlockOverlay, crackLayers, shapeBounds } from '../../../src/render/BlockOverlay.ts';
import { BOX_NO_TINT, BoxBatch, boxTint } from '../../../src/render/BoxBatch.ts';
import { DropView } from '../../../src/render/DropView.ts';
import { HandView } from '../../../src/render/HandView.ts';
import { buildItemModels } from '../../../src/render/itemModels.ts';
import { Particles } from '../../../src/render/Particles.ts';
import type { VoxelUniforms } from '../../../src/render/voxelMaterial.ts';
import type { ItemDropState } from '../../../src/sim/itemDrops.ts';
import { createPlayer } from '../../../src/sim/player.ts';
import type { Entity } from '../../../src/sim/Simulation.ts';
import { createRayHit } from '../../../src/world/raycast.ts';
import { flatWorld } from '../../helpers/flatWorld.ts';
import { packPixels, TEXTURE_SIZE } from '../../helpers/packPixels.ts';
import { registry } from '../../helpers/registry.ts';

const items = buildItemModels(registry, packPixels, TEXTURE_SIZE);
/** The batches and overlays only keep references to these uniforms. */
const shared = {
  uTextures: { value: null },
  uDaylight: { value: 1 },
  uSkyTint: { value: null },
  uTorchTint: { value: null },
  uMinLight: { value: 0 },
} as unknown as VoxelUniforms;

function drop(id: number, item: string, x: number, z: number): ItemDropState {
  return {
    kind: 'itemDrop',
    id,
    item,
    count: 1,
    body: { x, y: 64, z, vx: 0, vy: 0, vz: 0, onGround: true },
    prevX: x,
    prevY: 64,
    prevZ: z,
    age: 0,
    pickupDelay: 0,
    thrower: -1,
  };
}

describe('item drops', () => {
  it('details only the 64 nearest drops within 8 blocks, one box for the others', () => {
    const batch = new BoxBatch(shared, 8192, true);
    const view = new DropView(batch, flatWorld(), registry, items);
    const entities = new Map<number, Entity>();
    for (let i = 0; i < 100; i++) entities.set(i, drop(i, 'item:flint_knife', 2 + i * 0.05, 0));
    for (let i = 100; i < 105; i++) entities.set(i, drop(i, 'item:flint_knife', 20, i));
    batch.begin(0, 0, 0);
    view.drawAll(entities, 0, 65, 0, 1, 1 / 60);
    batch.end();
    const knife = items[registry.itemId('item:flint_knife')]!.parts.length;
    expect(batch.size).toBe(64 * knife + 36 + 5);
  });

  it('bobs and spins: the drawn boxes move between frames', () => {
    const batch = new BoxBatch(shared, 64, true);
    const view = new DropView(batch, flatWorld(), registry, items);
    const entities = new Map<number, Entity>([[1, drop(1, 'item:dirt', 0.5, 0.5)]]);
    const frame = () => {
      batch.begin(0, 0, 0);
      view.drawAll(entities, 0, 65, 0, 1, 0.2);
      batch.end();
      return Array.from(batch.mesh.instanceMatrix.array.slice(0, 16));
    };
    const first = frame();
    expect(frame()).not.toEqual(first);
    // Above the ground it lies on.
    expect(first[13]).toBeGreaterThan(64);
  });

  it('writes the tints and the alpha mode of each box', () => {
    const batch = new BoxBatch(shared, 64, true);
    const view = new DropView(batch, flatWorld(), registry, items);
    const tints = () => {
      const a = batch.mesh.geometry.getAttribute('aTints');
      return [a.getX(0), a.getY(0), a.getZ(0), a.getW(0)];
    };
    const draw = (item: string) => {
      batch.begin(0, 0, 0);
      view.drawAll(new Map([[1, drop(1, item, 0.5, 0.5)]]), 0, 65, 0, 1, 0.2);
      batch.end();
    };
    draw('item:foliage');
    const foliage = boxTint(basePack.tints.foliage);
    expect(tints()).toEqual([foliage, foliage, foliage, 1]);
    draw('item:stone');
    expect(tints()).toEqual([BOX_NO_TINT, BOX_NO_TINT, BOX_NO_TINT, 0]);
  });
});

describe('break particles', () => {
  it('throws chips of the broken block that fall, land and fade', () => {
    const batch = new BoxBatch(shared, 256, true);
    const particles = new Particles(batch, flatWorld(), registry.tables);
    const stone = registry.defaultState('block:stone');
    particles.burst(0, 63, 0, stone);
    expect(particles.alive()).toBe(10);
    batch.begin(0, 0, 0);
    particles.update(1 / 60);
    batch.end();
    expect(batch.size).toBe(10);
    const layers = batch.mesh.geometry.getAttribute('aLayers');
    expect(layers.getX(0)).toBe(registry.tables.faceLayer[stone * 6 + 4]);
    for (let i = 0; i < 90; i++) particles.update(1 / 60);
    expect(particles.alive()).toBe(0);
  });
});

describe('block overlays', () => {
  it('has a crack layer for every stage', () => {
    const layers = Array.from(crackLayers(basePack));
    expect(layers).toHaveLength(CRACK_STAGES);
    expect(new Set(layers).size).toBe(CRACK_STAGES);
    expect(layers.every((l) => l >= 0)).toBe(true);
  });

  it('fits the outline and cracks to the shape of the block', () => {
    const out = new Float64Array(6);
    shapeBounds(registry.tables, registry.defaultState('block:torch'), out);
    expect(Array.from(out)).toEqual([7 / 16, 0, 7 / 16, 9 / 16, 10 / 16, 9 / 16]);
    shapeBounds(registry.tables, registry.defaultState('block:stone'), out);
    expect(Array.from(out)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('shows the outline on the target, the crack of the mined block and the ghost', () => {
    const overlay = new BlockOverlay(shared, flatWorld(), registry.tables, basePack);
    const [outline, crack, ghost] = overlay.group.children;
    const hit = createRayHit();
    const targets = { hit, ghost: { x: 0, y: 64, z: 0, state: -1, upper: -1 } };
    overlay.update(targets);
    expect([outline!.visible, crack!.visible, ghost!.visible]).toEqual([false, false, false]);
    Object.assign(hit, {
      hit: true,
      x: 2,
      y: 63,
      z: 3,
      state: registry.defaultState('block:stone'),
    });
    overlay.setCrack(2, 63, 3, 5);
    targets.ghost.state = registry.defaultState('block:dirt');
    overlay.update(targets);
    expect([outline!.visible, crack!.visible, ghost!.visible]).toEqual([true, true, true]);
    expect(outline!.scale.x).toBeCloseTo(1.004, 9);
    expect(outline!.position.toArray()).toEqual([2.5, 63.5, 3.5]);
    expect(ghost!.position.toArray()).toEqual([0.5, 64.5, 0.5]);
    overlay.setCrack(2, 63, 3, -1);
    overlay.update(targets);
    expect(crack!.visible).toBe(false);
  });

  it('covers both cells of a door with its ghost', () => {
    const overlay = new BlockOverlay(shared, flatWorld(), registry.tables, basePack);
    const [, , ghost, upperGhost] = overlay.group.children;
    const lower = registry.defaultState('block:gate');
    const upper = registry.withState(lower, 'half', 'upper');
    const targets = { hit: createRayHit(), ghost: { x: 4, y: 65, z: -2, state: lower, upper } };
    overlay.update(targets);
    expect([ghost!.visible, upperGhost!.visible]).toEqual([true, true]);
    const span = (o: typeof ghost) => [
      o!.position.y - o!.scale.y / 2,
      o!.position.y + o!.scale.y / 2,
    ];
    expect([...span(ghost), ...span(upperGhost)]).toEqual([65, 66, 66, 67]);
    expect(upperGhost!.position.x).toBe(ghost!.position.x);
    expect(upperGhost!.position.z).toBe(ghost!.position.z);
    // A one-cell block, or no ghost at all, hides the upper box.
    overlay.update({ ...targets, ghost: { ...targets.ghost, upper: -1 } });
    expect([ghost!.visible, upperGhost!.visible]).toEqual([true, false]);
    overlay.update({ ...targets, ghost: { ...targets.ghost, state: -1 } });
    expect([ghost!.visible, upperGhost!.visible]).toEqual([false, false]);
  });
});

describe('hand view', () => {
  it('draws the arm and the held item, and strokes while primary is held', () => {
    const hand = new HandView(shared, registry, items);
    const player = createPlayer(1, 0, 64, 0, 2, registry.pack.balance);
    hand.draw(player, 1 / 60, true, 1, 0);
    expect(hand.batch.size).toBe(1);
    expect(hand.swing).toBe(0);
    player.inventory[0] = { item: 'item:flint_pickaxe', count: 1 };
    player.input = { ...player.input, primary: true };
    hand.draw(player, 0.1, true, 1, 0);
    expect(hand.swing).toBeGreaterThan(0.2);
    const pickaxe = items[registry.itemId('item:flint_pickaxe')]!.parts.length;
    expect(hand.batch.size).toBe(1 + pickaxe);
    player.input = { ...player.input, primary: false };
    for (let i = 0; i < 10; i++) hand.draw(player, 0.05, true, 1, 0);
    expect(hand.swing).toBe(0);
    hand.draw(player, 1 / 60, false, 1, 0);
    expect(hand.batch.size).toBe(0);
  });

  it('plays one stroke for a placement', () => {
    const hand = new HandView(shared, registry, items);
    const player = createPlayer(1, 0, 64, 0, 2, registry.pack.balance);
    hand.strike();
    hand.draw(player, 0.1, true, 1, 0);
    expect(hand.swing).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) hand.draw(player, 0.1, true, 1, 0);
    expect(hand.swing).toBe(0);
  });
});
