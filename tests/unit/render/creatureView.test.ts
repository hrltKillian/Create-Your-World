import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DYING_TICKS } from '../../../src/core/creatures.ts';
import { BoxBatch } from '../../../src/render/BoxBatch.ts';
import { CreatureView } from '../../../src/render/CreatureView.ts';
import {
  animateCreature,
  type CreatureMotion,
  createCreatureRig,
  HIT_FREEZE,
} from '../../../src/render/creatureRig.ts';
import { HandView } from '../../../src/render/HandView.ts';
import { buildItemModels } from '../../../src/render/itemModels.ts';
import type { VoxelUniforms } from '../../../src/render/voxelMaterial.ts';
import type { CreatureMode, CreatureState } from '../../../src/sim/creatures.ts';
import { createPlayer } from '../../../src/sim/player.ts';
import type { Entity } from '../../../src/sim/Simulation.ts';
import { flatWorld } from '../../helpers/flatWorld.ts';
import { packPixels, TEXTURE_SIZE } from '../../helpers/packPixels.ts';
import { registry } from '../../helpers/registry.ts';

/*
 * Creatures as drawn (docs « Animation »): every part of their box model, the gait's legs in two
 * half-cycles, the wind-up, the glowing Prowler eyes, the red flash and freeze of a hit, the fall
 * and shrink of a death; and the hand view's charged attack.
 */

const shared = {
  uTextures: { value: null },
  uDaylight: { value: 1 },
  uSkyTint: { value: null },
  uTorchTint: { value: null },
  uMinLight: { value: 0 },
} as unknown as VoxelUniforms;

const modelOf = (creature: string) => registry.model(registry.creature(creature)!.model)!;

function creature(id: number, key: string, x: number, z: number, mode: CreatureMode = 'idle') {
  const record: CreatureState = {
    kind: 'creature',
    id,
    creature: key,
    body: { x, y: 64, z, vx: 0, vy: 0, vz: 0, onGround: true },
    prevX: x,
    prevY: 64,
    prevZ: z,
    prevYaw: 0,
    yaw: 0,
    health: 10,
    mode,
    modeTicks: 0,
    target: -1,
    goalX: x,
    goalY: 64,
    goalZ: z,
    path: [],
    pathLength: 0,
    pathStep: 0,
    planTick: -1,
    planX: 0,
    planZ: 0,
    cooldown: 0,
    invulnerable: 0,
    sees: false,
    watched: false,
    unseen: 0,
    herd: id,
    cave: false,
  };
  return record;
}

const still: CreatureMotion = { distance: 0, speed: 0, mode: 'idle', look: 0, dt: 1 / 60 };

/** Draws one frame of `entities` and returns the batch and the view. */
function drawn(entities: Map<number, Entity>, view?: CreatureView, batch?: BoxBatch) {
  const b = batch ?? new BoxBatch(shared, 512, true);
  const v = view ?? new CreatureView(b, flatWorld(), registry);
  b.begin(0, 0, 0);
  v.drawAll(entities, 1, 1 / 60);
  b.end();
  return { batch: b, view: v };
}

/** The glow and flash of box `i`, and the world size of its box. */
function box(batch: BoxBatch, i: number) {
  const fx = batch.mesh.geometry.getAttribute('aFx');
  const m = new Matrix4().fromArray(batch.mesh.instanceMatrix.array, i * 16);
  return { glow: fx.getX(i), flash: fx.getY(i), size: new Vector3().setFromMatrixScale(m) };
}

describe('creature animation', () => {
  it('swings the legs of each half-cycle together, the halves in opposition', () => {
    for (const key of ['creature:trotter', 'creature:shagback']) {
      const model = modelOf(key);
      const rig = createCreatureRig();
      for (let i = 0; i < 30; i++)
        animateCreature(rig, model, { ...still, distance: 0.08, speed: 4.8, dt: 1 / 60 });
      const a = rig.angles;
      expect(rig.amplitude).toBeGreaterThan(0.3);
      if (model.gait === 'quadruped') {
        expect(a.legFL).toBeCloseTo(a.legBR!, 9);
        expect(a.legFR).toBeCloseTo(-a.legFL!, 9);
      } else {
        expect(a.legFL).toBeCloseTo(a.legMR!, 9);
        expect(a.legBL).toBeCloseTo(a.legFL!, 9);
        expect(a.legML).toBeCloseTo(-a.legFL!, 9);
      }
      // The phase advances by the model's stride per block.
      expect(rig.phase).toBeCloseTo(30 * 0.08 * model.stride, 9);
    }
  });

  it('raises the head and opens the jaw on the wind-up, freezes on a hit', () => {
    const model = modelOf('creature:prowler');
    const rig = createCreatureRig();
    for (let i = 0; i < 30; i++) animateCreature(rig, model, { ...still, mode: 'windup' });
    expect(rig.windup).toBeGreaterThan(0.9);
    expect(rig.angles.jaw).toBeGreaterThan(0.5);
    expect(rig.angles.head).toBeLessThan(-0.35);
    rig.flash = 1;
    rig.freeze = HIT_FREEZE;
    const time = rig.time;
    animateCreature(rig, model, { ...still, dt: HIT_FREEZE / 2 });
    expect(rig.time).toBe(time);
    expect(rig.flash).toBeLessThan(1);
    animateCreature(rig, model, { ...still, dt: HIT_FREEZE });
    animateCreature(rig, model, { ...still, dt: 1 / 60 });
    expect(rig.time).toBeGreaterThan(time);
  });
});

describe('creature view', () => {
  it('draws every part of each model; only the Prowler eyes glow', () => {
    const prowler = modelOf('creature:prowler');
    const trotter = modelOf('creature:trotter');
    const entities = new Map<number, Entity>([
      [1, creature(1, 'creature:prowler', 0.5, 0.5)],
      [2, creature(2, 'creature:trotter', 4.5, 0.5)],
    ]);
    const { batch } = drawn(entities);
    expect(batch.size).toBe(prowler.parts.length + trotter.parts.length);
    const glowing = prowler.parts.flatMap((p, i) => (box(batch, i).glow === 1 ? [p.name] : []));
    expect(glowing).toEqual(['eyeL', 'eyeR']);
    for (let i = prowler.parts.length; i < batch.size; i++) expect(box(batch, i).glow).toBe(0);
  });

  it('flashes a hurt creature red, falls and shrinks a dying one, forgets the gone', () => {
    const c = creature(1, 'creature:trotter', 0.5, 0.5);
    const entities = new Map<number, Entity>([[1, c]]);
    const { batch, view } = drawn(entities);
    expect(box(batch, 0).flash).toBe(0);
    view.hurt(1);
    drawn(entities, view, batch);
    expect(box(batch, 0).flash).toBeGreaterThan(0.9);
    const body = trotter('body');
    const standing = box(batch, body).size.length();
    Object.assign(c, { mode: 'dying', modeTicks: 2 });
    drawn(entities, view, batch);
    expect(box(batch, body).size.length()).toBeLessThan(standing * 0.2);
    c.modeTicks = DYING_TICKS;
    drawn(entities, view, batch);
    expect(box(batch, body).size.length()).toBeCloseTo(standing, 5);
    entities.delete(1);
    drawn(entities, view, batch);
    expect(batch.size).toBe(0);
    expect(view.rig(1)).toBeNull();
  });
});

/** Index of a part of the Trotter's model. */
function trotter(name: string): number {
  return modelOf('creature:trotter').parts.findIndex((p) => p.name === name);
}

describe('hand view attacks', () => {
  it('draws the arm back while an attack charges and strikes once on the release', () => {
    const items = buildItemModels(registry, packPixels, TEXTURE_SIZE);
    const hand = new HandView(shared, registry, items);
    const player = createPlayer(1, 0, 64, 0, 2, registry.pack.balance);
    player.input = { ...player.input, primary: true };
    player.charge = 10;
    for (let i = 0; i < 20; i++) hand.draw(player, 0.05, true, 1, 0);
    expect(hand.swing).toBe(0);
    expect(hand.windup).toBeGreaterThan(0.9);
    player.input = { ...player.input, primary: false };
    player.charge = -1;
    hand.draw(player, 0.1, true, 1, 0);
    expect(hand.swing).toBeGreaterThan(0.2);
    for (let i = 0; i < 20; i++) hand.draw(player, 0.05, true, 1, 0);
    expect(hand.swing).toBe(0);
    expect(hand.windup).toBeLessThan(0.01);
  });
});
