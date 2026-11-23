import { describe, expect, it } from 'vitest';
import { ClientAim } from '../../../src/app/ClientAim.ts';
import { createPlayer } from '../../../src/sim/player.ts';
import { flatWorld } from '../../helpers/flatWorld.ts';
import { registry } from '../../helpers/registry.ts';

const DOWN = -Math.PI / 2 + 0.01;

function aimer() {
  const world = flatWorld();
  const player = createPlayer(1, 0.5, 64, 0.5, 2);
  return { world, player, aim: new ClientAim(world, registry, player) };
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
});
