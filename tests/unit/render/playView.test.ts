import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { CRACK_STAGES } from '../../../src/content/schema.ts';
import { BlockOverlay, crackLayers, shapeBounds } from '../../../src/render/BlockOverlay.ts';
import { BOX_NO_TINT, BoxBatch, boxTint } from '../../../src/render/BoxBatch.ts';
import { CameraRig } from '../../../src/render/CameraRig.ts';
import { DropView } from '../../../src/render/DropView.ts';
import { HandView } from '../../../src/render/HandView.ts';
import { buildItemModels } from '../../../src/render/itemModels.ts';
import { LAND_DUST_PER_BLOCK, MINE_DUST, TRAIL_BOXES } from '../../../src/render/Particles.ts';
import { PlayView } from '../../../src/render/PlayView.ts';
import type { WorldView } from '../../../src/render/WorldView.ts';
import type { SimView } from '../../../src/sim/host.ts';
import type { ItemDropState } from '../../../src/sim/itemDrops.ts';
import { createPlayer } from '../../../src/sim/player.ts';
import type { Entity } from '../../../src/sim/Simulation.ts';
import { createRayHit } from '../../../src/world/raycast.ts';
import { boxUniforms } from '../../helpers/boxUniforms.ts';
import { flatWorld } from '../../helpers/flatWorld.ts';
import { packPixels, TEXTURE_SIZE } from '../../helpers/packPixels.ts';
import { registry } from '../../helpers/registry.ts';

const items = buildItemModels(registry, packPixels, TEXTURE_SIZE);
const shared = boxUniforms;

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
    draw('item:tall_grass');
    const grass = boxTint(basePack.tints.grass);
    expect(tints()).toEqual([grass, grass, grass, 1]);
    draw('item:stone');
    expect(tints()).toEqual([BOX_NO_TINT, BOX_NO_TINT, BOX_NO_TINT, 0]);
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

describe('hand view inertia', () => {
  const FRAME = 1 / 60;
  /** Translation x of the first box drawn (the forearm). */
  const armX = (hand: HandView) => hand.batch.mesh.instanceMatrix.array[12]!;

  it('lags behind a turn of the view and eases back to rest', () => {
    const hand = new HandView(shared, registry, items);
    const player = createPlayer(1, 0, 64, 0, 2, registry.pack.balance);
    const frame = (yaw: number, pitch: number) => {
      hand.look(yaw, pitch);
      hand.draw(player, FRAME, true, 1, 0);
    };
    frame(0, 0);
    const rest = armX(hand);
    expect([hand.swayX, hand.swayY, hand.swayZ]).toEqual([0, 0, 0]);
    // A quick turn to the left leaves the hand on the right, a look up leaves it lower: the
    // frame of the turn shows its whole lag, whatever the frame time.
    frame(0.3, 0.2);
    expect(hand.swayX).toBeCloseTo(0.03, 9);
    expect(hand.swayY).toBeCloseTo(-0.02, 9);
    expect(armX(hand)).toBeGreaterThan(rest + 0.01);
    for (let i = 0; i < 60; i++) frame(0.3, 0.2);
    expect(Math.abs(hand.swayX)).toBeLessThan(1e-3);
    expect(Math.abs(hand.swayY)).toBeLessThan(1e-3);
    expect(armX(hand)).toBeCloseTo(rest, 3);
    // However fast the turn (left and down here: the hand is left right and high), it stays in view.
    frame(40, -40);
    expect([hand.swayX, hand.swayY]).toEqual([0.05, 0.05]);
  });

  it('leans against the motion while moving or falling, and comes back once still', () => {
    const hand = new HandView(shared, registry, items);
    const player = createPlayer(1, 0, 64, 0, 2, registry.pack.balance);
    // Facing north (yaw 0): moving east is to the right, north is ahead.
    Object.assign(player.body, { vx: 4.3, vy: -10, vz: -4.3 });
    for (let i = 0; i < 60; i++) hand.draw(player, FRAME, true, 1, 0);
    expect(hand.swayX).toBeLessThan(-0.01);
    expect(hand.swayY).toBeGreaterThan(0.01);
    expect(hand.swayZ).toBeGreaterThan(0.01);
    Object.assign(player.body, { vx: 0, vy: 0, vz: 0 });
    for (let i = 0; i < 60; i++) hand.draw(player, FRAME, true, 1, 0);
    expect(Math.abs(hand.swayX) + Math.abs(hand.swayY) + Math.abs(hand.swayZ)).toBeLessThan(1e-3);
  });

  it('flags the frame of a strong swing (from a full gauge), not of a plain one', () => {
    const hand = new HandView(shared, registry, items);
    const player = createPlayer(1, 0, 64, 0, 2, registry.pack.balance);
    hand.draw(player, FRAME, true, 1, 0);
    expect(hand.released).toBe(false);
    // A swing from a full gauge: its ticks left rise from 0.
    player.attackCooldown = 12;
    hand.draw(player, FRAME, true, 1, 0);
    expect(hand.released).toBe(true);
    player.attackCooldown = 8;
    hand.draw(player, FRAME, true, 1, 0);
    expect(hand.released).toBe(false);
    // A swing before the gauge is full: plain, no trail.
    player.attackCooldown = 12;
    hand.draw(player, FRAME, true, 1, 0);
    expect(hand.released).toBe(false);
  });
});

describe('play feel', () => {
  /** A play view over a flat world (stand-in world view and simulation) and its camera rig. */
  function playSetup() {
    const textures = { image: { data: packPixels, width: TEXTURE_SIZE } };
    const tintColors = [new Color(1, 1, 1), new Color(0.2, 0.6, 0.1)];
    const uniforms = {
      ...shared,
      uTextures: { value: textures },
      uTintColors: { value: tintColors },
    };
    const view = {
      materials: { uniforms },
      scene: { add() {}, remove() {} },
      attachHand() {},
      reach: 64,
    } as unknown as WorldView;
    const player = createPlayer(1, 0.5, 64, 0.5, 2, registry.pack.balance);
    const sim = {
      registry,
      world: flatWorld(),
      entities: new Map(),
      playerId: 1,
      player: () => player,
    } as unknown as SimView;
    const rig = new CameraRig();
    const play = new PlayView(view, sim, rig);
    const eye = { x: 0.5, y: 65.62, z: 0.5 };
    const frame = () =>
      play.draw({
        player,
        alpha: 1,
        dt: 1 / 60,
        pose: { ...eye, yaw: 0, pitch: 0 },
        eye,
        firstPerson: true,
        avatarVisible: false,
        targets: { hit: createRayHit(), ghost: { x: 0, y: 0, z: 0, state: -1, upper: -1 } },
      });
    const settle = () => rig.update(player, 1, sim.world, registry.tables, 1 / 60);
    settle();
    return { play, rig, player, frame, settle };
  }

  it('turns the local player’s mining, landing and blows into dust, a dip and a roll', () => {
    const { play, rig, player, frame, settle } = playSetup();
    const local = { playerId: 1 };
    play.onEvent({ type: 'mineProgress', ...local, x: 0, y: 63, z: -2, stage: 0 });
    expect(play.particles.alive()).toBe(MINE_DUST);
    play.onEvent({ type: 'mineProgress', ...local, x: 0, y: 63, z: -2, stage: -1 });
    expect(play.particles.alive()).toBe(MINE_DUST);
    play.onEvent({ type: 'playerLanded', ...local, fall: 2 });
    expect(play.particles.alive()).toBe(MINE_DUST + 2 * LAND_DUST_PER_BLOCK);
    play.onEvent({ type: 'playerHurt', ...local, amount: 5, source: 9, x: 5, z: 0.5 });
    // Another player's events change nothing here.
    play.onEvent({ type: 'playerLanded', playerId: 2, fall: 4 });
    expect(play.particles.alive()).toBe(MINE_DUST + 2 * LAND_DUST_PER_BLOCK);
    for (let i = 0; i < 4; i++) settle();
    expect(rig.pose.y).toBeLessThan(rig.eye.y - 0.05);
    expect(rig.pose.roll).toBeLessThan(-0.03);
    // A strong swing draws its trail in the same frame, in the one world batch.
    play.particles.setEnabled(false);
    play.particles.setEnabled(true);
    frame();
    expect(play.batch.size).toBe(0);
    player.attackCooldown = 12;
    frame();
    expect(play.particles.alive()).toBe(TRAIL_BOXES);
    expect(play.batch.size).toBe(TRAIL_BOXES);
  });
});
