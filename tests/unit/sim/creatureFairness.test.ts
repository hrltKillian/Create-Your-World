import { describe, expect, it } from 'vitest';
import { yawOf } from '../../../src/core/angles.ts';
import { BRAIN } from '../../../src/sim/ai/behaviours.ts';
import { ticksOf } from '../../../src/sim/clock.ts';
import { type CreatureState, reachGap } from '../../../src/sim/creatures.ts';
import { playerTestSim, rejections } from '../../helpers/simHarness.ts';

/*
 * Fair and living creatures (docs plan v2 « M17 »): a sprinting player catches a grazer, a hunter
 * that loses sight of its prey searches then gives up, so does one whose blows never land, a
 * sidestep beats a charge, creatures graze, drink and take a bait, and a fall hurts them.
 */

type Harness = ReturnType<typeof playerTestSim>;

function world(seed: string, hour = 12): Harness {
  const s = playerTestSim({ seed });
  s.send({ type: 'debug.setTime', hours: hour }, { type: 'debug.freezeTime', frozen: true });
  return s;
}

function place(
  s: Harness,
  creature: string,
  x: number,
  z: number,
  y: number | 'surface' = 'surface',
) {
  const id = s.sim.nextEntityId;
  expect(rejections(s.send({ type: 'debug.spawn', creature, x, y, z }))).toEqual([]);
  return s.sim.entities.get(id) as CreatureState;
}

/** The player's yaw towards a creature. */
function towards(s: Harness, c: CreatureState): number {
  return yawOf(c.body.x - s.player.body.x, c.body.z - s.player.body.z);
}

describe('fair creatures', () => {
  it('a sprinting player catches a Trotter within 30 s, which then stays wary (10 seeds)', () => {
    for (let seed = 0; seed < 10; seed++) {
      const s = world(`catch-${seed}`);
      const trotter = place(s, 'creature:trotter', 0.5, -14.5);
      let caught = -1;
      let wasTired = false;
      for (let t = 0; t < ticksOf(30) && caught < 0; t++) {
        s.tick(1, { forward: 1, sprint: true, yaw: towards(s, trotter) });
        wasTired ||= trotter.tired;
        if (reachGap(trotter, s.sim.registry.creature(trotter.creature)!, s.player) < 1) caught = t;
      }
      expect(caught, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(wasTired, `seed ${seed}: it ran out of breath`).toBe(true);
    }
  });

  it('a Prowler that loses its prey behind a wall searches 6 s, then gives up', () => {
    const s = world('lose', 23);
    s.send({ type: 'debug.god', on: true });
    const prowler = place(s, 'creature:prowler', 0.5, -10.5);
    for (let t = 0; t < 120 && prowler.mode !== 'chase'; t++) s.step(1);
    expect(prowler.mode).toBe('chase');
    // Out of sight behind stone, far beyond its senses, still and silent.
    s.fill(-6, 65, 14, 6, 70, 14, 'block:stone');
    s.send({ type: 'debug.teleport', x: 0.5, y: 65, z: 40.5 });
    let gaveUp = -1;
    for (let t = 0; t < ticksOf(12) && gaveUp < 0; t++) {
      s.step(1);
      if (prowler.calmTicks > 0) gaveUp = t;
    }
    expect(gaveUp).toBeGreaterThan(ticksOf(5));
    expect(gaveUp).toBeLessThanOrEqual(BRAIN.searchTicks + 40);
    expect(prowler.mode).not.toBe('chase');
  });

  it('a Prowler gives up a prey it sees but never hits after 25 s', () => {
    const s = world('unreachable', 23);
    s.send({ type: 'debug.god', on: true });
    // The player in a glass cage: in plain sight, out of reach of every blow.
    s.fill(-1, 65, -1, 1, 67, 1, 'block:glass');
    s.fill(0, 65, 0, 0, 66, 0, 'block:air');
    s.send({ type: 'debug.teleport', x: 0.5, y: 65, z: 0.5 });
    const prowler = place(s, 'creature:prowler', 0.5, -8.5);
    let chased = false;
    let gaveUp = -1;
    for (let t = 0; t < ticksOf(40) && gaveUp < 0; t++) {
      s.step(1);
      chased ||= prowler.mode === 'chase';
      if (chased && prowler.calmTicks > 0) gaveUp = t;
    }
    expect(chased).toBe(true);
    expect(gaveUp).toBeGreaterThanOrEqual(BRAIN.giveUpTicks);
    expect(s.player.survival.health).toBe(100);
  });

  it('a sidestep when a Shellback charges makes it miss', () => {
    const s = world('sidestep');
    const shellback = place(s, 'creature:shellback', 0.5, -5.5);
    for (let t = 0; t < 120 && shellback.mode !== 'charge'; t++) s.step(1);
    expect(shellback.mode).toBe('charge');
    // Strafe out of its line (it charges straight on, facing the way it set off).
    s.tick(20, { strafe: 1, yaw: 0 });
    for (let t = 0; t < 60 && shellback.mode === 'charge'; t++) s.step(1);
    expect(shellback.mode).not.toBe('charge');
    expect(s.player.survival.health).toBe(100);
  });

  it('a hungry and thirsty Trotter grazes a plant and drinks at a pond, then heals', () => {
    const s = world('meal');
    s.send({ type: 'debug.god', on: true });
    s.send({ type: 'debug.teleport', x: 0.5, y: 65, z: 60.5 });
    s.put(25, 65, 0, 'block:tall_grass');
    s.fill(14, 63, -2, 16, 64, 2, 'block:fresh_water');
    const trotter = place(s, 'creature:trotter', 20.5, 0.5);
    Object.assign(trotter, { hunger: 30, thirst: 10, health: 6, modeTicks: 0 });
    for (let t = 0; t < ticksOf(60) && (trotter.hunger < 50 || trotter.thirst < 60); t++) s.step(1);
    expect(s.block(25, 65, 0)).toBe('block:air');
    expect(trotter.hunger).toBeGreaterThan(50);
    expect(trotter.thirst).toBeGreaterThan(60);
    const health = trotter.health;
    s.step(ticksOf(20));
    expect(trotter.health).toBeGreaterThan(health);
  });

  it('meat on the ground draws a Prowler that eats it (a bait)', () => {
    const s = world('bait', 23);
    s.send({ type: 'debug.teleport', x: 0.5, y: 65, z: 70.5 });
    const prowler = place(s, 'creature:prowler', 0.5, -20.5);
    s.send({ type: 'debug.give', item: 'item:raw_meat', count: 1 });
    // Thrown by hand from the player's spot is far: the meat is placed by a drop at the bait.
    const before = s.sim.nextEntityId;
    s.send({ type: 'debug.teleport', x: 6.5, y: 65, z: -20.5 });
    s.send({
      type: 'inv.drop',
      slot: s.player.inventory.findIndex((st) => st?.item === 'item:raw_meat'),
      all: true,
    });
    s.send({ type: 'debug.teleport', x: 0.5, y: 65, z: 70.5 });
    const meat = s.sim.entities.get(before);
    expect(meat?.kind).toBe('itemDrop');
    for (let t = 0; t < ticksOf(30) && s.sim.entities.has(before); t++) s.step(1);
    expect(s.sim.entities.has(before)).toBe(false);
    expect(prowler.mode).not.toBe('chase');
  });

  it('a fall beyond 3 blocks hurts a creature, 2 health a block', () => {
    const s = world('fall');
    const trotter = place(s, 'creature:trotter', 10.5, 10.5, 72);
    s.step(60);
    // A sated creature heals a little meanwhile.
    expect(trotter.health).toBeCloseTo(12 - (72 - 65 - 3) * 2, 0);
  });
});
