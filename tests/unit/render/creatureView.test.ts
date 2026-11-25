import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DYING_TICKS } from '../../../src/core/creatures.ts';
import { BoxBatch, fullSkin, WORLD_BOXES } from '../../../src/render/BoxBatch.ts';
import { CameraRig } from '../../../src/render/CameraRig.ts';
import { CreatureView } from '../../../src/render/CreatureView.ts';
import {
  animateCreature,
  type CreatureMotion,
  createCreatureRig,
  HIT_FREEZE,
} from '../../../src/render/creatureRig.ts';
import { HandView } from '../../../src/render/HandView.ts';
import { buildItemModels } from '../../../src/render/itemModels.ts';
import { PlayView } from '../../../src/render/PlayView.ts';
import type { WorldView } from '../../../src/render/WorldView.ts';
import { type CreatureMode, type CreatureState, freshNeeds } from '../../../src/sim/creatures.ts';
import type { SimView } from '../../../src/sim/host.ts';
import { createPlayer } from '../../../src/sim/player.ts';
import type { Entity } from '../../../src/sim/Simulation.ts';
import { createRayHit } from '../../../src/world/raycast.ts';
import { boxUniforms } from '../../helpers/boxUniforms.ts';
import { flatWorld } from '../../helpers/flatWorld.ts';
import { packPixels, TEXTURE_SIZE } from '../../helpers/packPixels.ts';
import { registry } from '../../helpers/registry.ts';

/*
 * Creatures as drawn (docs « Animation »): every part of their box model, the gait's legs in two
 * half-cycles, the wind-up, the glowing Prowler eyes, the red flash and freeze of a hit, the fall
 * and shrink of a death; and the hand view's swings.
 */

const shared = boxUniforms;

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
    ...freshNeeds(registry.creature(key)!, 64),
  };
  return record;
}

/** Horizontal reach of render distance 6 (blocks). */
const REACH = 6 * 32;

const still: CreatureMotion = { distance: 0, speed: 0, mode: 'idle', look: 0, dt: 1 / 60 };

/** Draws one frame of `entities` and returns the batch and the view. */
function drawn(entities: Map<number, Entity>, view?: CreatureView, batch?: BoxBatch) {
  const b = batch ?? new BoxBatch(shared, 512, true);
  const v = view ?? new CreatureView(b, flatWorld(), registry);
  b.begin(0, 0, 0);
  v.drawAll(entities, 0, 0, REACH, 1, 1 / 60);
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

  it('freezes only the pose of a hurt creature: its knockback is drawn without a snap', () => {
    const c = creature(1, 'creature:trotter', 0.5, 0.5);
    const entities = new Map<number, Entity>([[1, c]]);
    const { batch, view } = drawn(entities);
    const array = batch.mesh.instanceMatrix.array;
    const body = trotter('body');
    view.hurt(1);
    const angles = { ...view.rig(1)!.angles };
    let z = array[body * 16 + 14]!;
    // The knockback carries the body 0.1 block a frame, through the freeze and after it.
    for (let frame = 0; frame < 10; frame++) {
      c.prevZ = c.body.z;
      c.body.z += 0.1;
      const frozen = view.rig(1)!.freeze > 0;
      drawn(entities, view, batch);
      if (frozen) expect(view.rig(1)!.angles).toEqual(angles);
      expect(array[body * 16 + 14]! - z).toBeCloseTo(0.1, 1);
      z = array[body * 16 + 14]!;
    }
  });
});

describe('creature view budget', () => {
  const parts = modelOf('creature:trotter').parts.length;

  it('draws no creature beyond the render distance from the camera', () => {
    const entities = new Map<number, Entity>([
      [1, creature(1, 'creature:trotter', 100.5, 140.5)],
      [2, creature(2, 'creature:trotter', -150.5, 130.5)],
    ]);
    const batch = new BoxBatch(shared, 512, true);
    const view = new CreatureView(batch, flatWorld(), registry);
    batch.begin(0, 0, 0);
    view.drawAll(entities, 0.5, 0.5, REACH, 1, 1 / 60);
    batch.end();
    expect(batch.size).toBe(parts);
    expect(view.rig(1)).not.toBeNull();
    expect(view.rig(2)).toBeNull();
  });

  it('fills only the room left in the batch, the nearest creatures first', () => {
    const batch = new BoxBatch(shared, WORLD_BOXES, true);
    const view = new CreatureView(batch, flatWorld(), registry);
    const entities = new Map<number, Entity>();
    // The oldest records, first in the map like old herds, are the farthest.
    const count = 1000;
    for (let id = 1; id <= count; id++)
      entities.set(id, creature(id, 'creature:trotter', 0.5, 180.5 - id * 0.18));
    batch.begin(0, 0, 0);
    // What the avatar, the drops and the particles took before.
    const before = 3000;
    const skin = fullSkin(0);
    for (let i = 0; i < before; i++) batch.add(new Matrix4(), skin, 1, 0);
    view.drawAll(entities, 0.5, 0.5, REACH, 1, 1 / 60);
    batch.end();
    const shown = [...entities.keys()].filter((id) => view.rig(id) !== null);
    expect(shown.length).toBeGreaterThan(100);
    // Every creature drawn is drawn whole, and they are the nearest ones.
    expect(batch.size - before).toBe(shown.length * parts);
    expect(shown[0]).toBe(count - shown.length + 1);
    expect(shown.at(-1)).toBe(count);
  });

  it('never starves the item drops, however many creatures are near', () => {
    const textures = { image: { data: packPixels, width: TEXTURE_SIZE } };
    const uniforms = { ...shared, uTextures: { value: textures }, uTintColors: { value: [] } };
    const worldView = {
      materials: { uniforms },
      scene: { add() {}, remove() {} },
      attachHand() {},
      reach: REACH,
    } as unknown as WorldView;
    const entities = new Map<number, Entity>();
    for (let id = 1; id <= 1000; id++) {
      const x = 20.5 + (id % 40) * 2;
      entities.set(id, creature(id, 'creature:trotter', x, 20.5 + Math.floor(id / 40) * 2));
    }
    const knife = 'item:flint_knife';
    entities.set(1001, {
      kind: 'itemDrop',
      id: 1001,
      item: knife,
      count: 1,
      body: { x: 0.5, y: 64, z: -1.5, vx: 0, vy: 0, vz: 0, onGround: true },
      prevX: 0.5,
      prevY: 64,
      prevZ: -1.5,
      age: 0,
      pickupDelay: 0,
      thrower: -1,
    });
    const sim = { registry, world: flatWorld(), entities, playerId: 1 } as unknown as SimView;
    const play = new PlayView(worldView, sim, new CameraRig());
    const eye = { x: 0.5, y: 65.6, z: 0.5 };
    play.draw({
      player: createPlayer(1, 0.5, 64, 0.5, 2, registry.pack.balance),
      alpha: 1,
      dt: 1 / 60,
      pose: { ...eye, yaw: 0, pitch: 0 },
      eye,
      firstPerson: true,
      avatarVisible: false,
      targets: { hit: createRayHit(), ghost: { x: 0, y: 0, z: 0, state: -1, upper: -1 } },
    });
    // Boxes around the drop (instances are relative to the camera section, origin (0, 64, 0)).
    const array = play.batch.mesh.instanceMatrix.array;
    let near = 0;
    for (let i = 0; i < play.batch.size; i++)
      if (Math.abs(array[i * 16 + 12]! - 0.5) < 2 && Math.abs(array[i * 16 + 14]! + 1.5) < 2)
        near++;
    const items = buildItemModels(registry, packPixels, TEXTURE_SIZE);
    expect(near).toBe(items[registry.itemId(knife)]!.parts.length);
    expect(play.batch.size).toBeLessThanOrEqual(WORLD_BOXES);
  });
});

/** Index of a part of the Trotter's model. */
function trotter(name: string): number {
  return modelOf('creature:trotter').parts.findIndex((p) => p.name === name);
}

describe('hand view attacks', () => {
  it('strikes once a swing, held or not, and not again while the swing is held', () => {
    const items = buildItemModels(registry, packPixels, TEXTURE_SIZE);
    const hand = new HandView(shared, registry, items);
    const player = createPlayer(1, 0, 64, 0, 2, registry.pack.balance);
    player.input = { ...player.input, primary: true };
    player.swinging = true;
    player.attackCooldown = 12;
    hand.draw(player, 0.1, true, 1, 0);
    expect(hand.swing).toBeGreaterThan(0.2);
    for (let i = 0; i < 20; i++) hand.draw(player, 0.05, true, 1, 0);
    expect(hand.swing).toBe(0);
  });
});
