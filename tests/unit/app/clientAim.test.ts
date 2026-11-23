import { describe, expect, it } from 'vitest';
import { ClientAim } from '../../../src/app/ClientAim.ts';
import type { CreatureState } from '../../../src/sim/creatures.ts';
import { eyeHeight } from '../../../src/sim/physics.ts';
import { createPlayer } from '../../../src/sim/player.ts';
import { flatWorld } from '../../helpers/flatWorld.ts';
import { registry } from '../../helpers/registry.ts';
import { playerTestSim, rejections } from '../../helpers/simHarness.ts';

const DOWN = -Math.PI / 2 + 0.01;

function aimer() {
  const world = flatWorld();
  const player = createPlayer(1, 0.5, 64, 0.5, 2, registry.pack.balance);
  const entities = new Map([[player.id, player]]);
  return { world, player, aim: new ClientAim(world, registry, player, entities) };
}

describe('client aim', () => {
  it('targets the block under the crosshair with the face it enters', () => {
    const { aim } = aimer();
    aim.update({ x: 0.5, y: 65.62, z: 0.5 }, 0, DOWN, 0, false);
    expect(aim.target()).toEqual({ x: 0, y: 63, z: 0, face: 2 });
    aim.update({ x: 0.5, y: 65.62, z: 0.5 }, 0, Math.PI / 2 - 0.01, 0, false);
    expect(aim.hit.hit).toBe(false);
    expect(aim.target()).toBeUndefined();
  });

  it('plans the ghost of a held block with the placement rules', () => {
    const { aim, player } = aimer();
    // Looking at the floor in front: the cell above the hit is free.
    aim.update({ x: 0.5, y: 65.62, z: 0.5 }, 0, -0.6, 0, false);
    expect(aim.ghost.state).toBe(-1);
    player.inventory[0] = { item: 'item:dirt', count: 3 };
    aim.update({ x: 0.5, y: 65.62, z: 0.5 }, 0, -0.6, 0, false);
    const { x, y, z, state } = aim.ghost;
    expect(state).toBe(registry.defaultState('block:dirt'));
    expect([x, y, z]).toEqual([aim.hit.x, 64, aim.hit.z]);
    // Straight down, the cell is the player's own: refused, no ghost.
    aim.update({ x: 0.5, y: 65.62, z: 0.5 }, 0, DOWN, 0, false);
    expect(aim.ghost.state).toBe(-1);
    // A slot holding a tool places nothing.
    player.inventory[1] = { item: 'item:flint_pickaxe', count: 1 };
    aim.update({ x: 0.5, y: 65.62, z: 0.5 }, 0, -0.6, 1, false);
    expect(aim.ghost.state).toBe(-1);
  });

  it('describes both halves of a door ghost', () => {
    const { aim, player } = aimer();
    player.inventory[0] = { item: 'item:dirt', count: 3 };
    aim.update({ x: 0.5, y: 65.62, z: 0.5 }, 0, -0.6, 0, false);
    expect(aim.ghost.upper).toBe(-1);
    player.inventory[0] = { item: 'item:gate', count: 1 };
    aim.update({ x: 0.5, y: 65.62, z: 0.5 }, 0, -0.6, 0, false);
    const { state, upper } = aim.ghost;
    expect(registry.states[state]!.props.half).toBe('lower');
    expect(upper).toBe(registry.withState(state, 'half', 'upper'));
    // Refused (straight down, inside the player): no ghost and no upper half.
    aim.update({ x: 0.5, y: 65.62, z: 0.5 }, 0, DOWN, 0, false);
    expect([aim.ghost.state, aim.ghost.upper]).toEqual([-1, -1]);
  });
});

describe('client aim at creatures', () => {
  /** The flat test world, a Trotter 2 blocks north of the player and the aim over its entities. */
  function scene(z = -1.5) {
    const s = playerTestSim({ seed: 'aim-creature' });
    s.send({ type: 'debug.setTime', hours: 12 }, { type: 'debug.freezeTime', frozen: true });
    const id = s.sim.nextEntityId;
    const spawn = {
      type: 'debug.spawn',
      creature: 'creature:trotter',
      x: 0.5,
      y: 'surface',
      z,
    } as const;
    expect(rejections(s.send(spawn))).toEqual([]);
    const c = s.sim.entities.get(id) as CreatureState;
    c.modeTicks = 600;
    const b = s.player.body;
    const eye = { x: b.x, y: b.y + eyeHeight(b), z: b.z };
    const def = registry.creature(c.creature)!;
    const pitch = Math.atan2(c.body.y + def.hitbox[1] / 2 - eye.y, b.z - c.body.z);
    const aim = new ClientAim(s.sim.world, registry, s.player, s.sim.entities);
    return { s, c, eye, pitch, aim };
  }

  it('aims at a creature in reach before the block behind it: no outline, ghost or block target', () => {
    const { s, c, eye, pitch, aim } = scene();
    s.player.inventory[0] = { item: 'item:dirt', count: 3 };
    aim.update(eye, 0, pitch, 0, false);
    expect(aim.creature?.id).toBe(c.id);
    expect(aim.hit.hit).toBe(false);
    expect(aim.ghost.state).toBe(-1);
    expect(aim.target()).toBeUndefined();
    // Tall grass in its cell does not hide it; a solid block in front does.
    s.put(0, 65, -1, 'block:tall_grass');
    aim.update(eye, 0, pitch, 0, false);
    expect(aim.creature?.id).toBe(c.id);
    s.put(0, 65, -1, 'block:glass');
    aim.update(eye, 0, pitch, 0, false);
    expect(aim.creature).toBeUndefined();
    expect(aim.target()).toMatchObject({ x: 0, y: 65, z: -1 });
  });

  it('a creature out of the held weapon’s reach is not aimed at; a spear reaches it', () => {
    const { s, c, eye, pitch, aim } = scene(-3.5);
    aim.update(eye, 0, pitch, 0, false);
    expect(aim.creature).toBeUndefined();
    s.player.inventory[1] = { item: 'item:flint_spear', count: 1 };
    aim.update(eye, 0, pitch, 1, false);
    expect(aim.creature?.id).toBe(c.id);
  });
});
